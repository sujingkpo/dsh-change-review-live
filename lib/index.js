/**
 * diff-review host half: observes write/edit tool executions and serves the
 * modification-review payloads over plain HTTP routes for the browser UI.
 * Records are bucketed by the owning agent/session so each session reviews
 * only its own changes. Loaded as a static row in the web profile composition.
 *
 * Revert support: every op records the full before/after file content that the
 * write/edit tool reports, so the UI can either undo ONE specific op (keeping
 * later, non-overlapping changes via a 3-way line merge) or revert the WHOLE
 * file (restore the pre-session snapshot, or delete a file created in-session).
 *
 * @author chenzhenyao / cirelir
 * @date 2026-08-21
 */
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, statSync } from 'node:fs'
import { execSync, execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'

// 快照存储上限（字符）：≤5MB 的文件保存完整前后快照，支撑精确 diff 与撤回；
// 超过 5MB 的超大文件不支持快照（显示回退到编辑片段、该记录不可撤回），
// 避免截断出误导性内容、也避免状态文件被超大文件无限撑大
const SNAPSHOT_MAX_CHARS = 5000000
// 编辑片段/整文件内容用于展示的上限（old_string/new_string/content）
const FRAG_MAX_CHARS = 350000
const MAX_OPS = 100
// 整段 LCS 的预算（diffLines 是 (n+1)×(m+1) 的 Int32 表）：
// 3000×3000 ≈ 36MB，桌面端几十毫秒；**超过不再截断，改走分块 LCS**
const MAX_DIFF_LINES = 3000
// 超大差异段的分块宽度：每块 1000×1000 ≈ 4MB DP 表，做完即释放
const DIFF_CHUNK_LINES = 1000
// 硬上限：超过这个行数才真的截断（单侧为空时是展示上限，双侧时是分块 diff 的总量上限）。
// 单侧为空（新建文件 / 整文件重写）没有 DP 成本，双侧走分块也只需要 O(n·chunk) 时间
const MAX_WHOLE_LINES = 20000
const MAX_MERGE_LINES = 2000

const name = 'diff-review'
const inject = ['webServer', 'agents']

// 二进制内容在面板里只给一行说明：PNG/JPEG/压缩包被当文本读入时会是几百 KB 乱码
// （实测一张 PixPin 截图的 PNG：内容 44 万字符、单行 15 万字符），逐行对比既没意义
// 又会把面板撑爆（换行模式下折成两万行、不折行模式下滚动宽度上百万像素）
const BINARY_NOTICE = '（二进制内容，已跳过文本对比）'
function looksBinaryText(s) {
  if (typeof s !== 'string' || s.length === 0) { return false }
  const probe = s.length > 8192 ? s.slice(0, 8192) : s
  // NUL 字节是最可靠的二进制信号
  if (probe.indexOf('\u0000') >= 0) { return true }
  // 再补一个「不可打印字符占比」判断（UTF-8 解码失败产生的 U+FFFD 也算）
  let weird = 0
  for (let i = 0; i < probe.length; i++) {
    const c = probe.charCodeAt(i)
    if (c === 9 || c === 10 || c === 13) { continue }
    if (c < 32 || c === 0xFFFD) { weird++ }
  }
  return weird / probe.length > 0.1
}

// 展示用片段截断（old_string/new_string/content）
function cap(s) {
  if (typeof s !== 'string') s = s == null ? '' : String(s)
  return s.slice(0, FRAG_MAX_CHARS)
}

// 快照存储：null 原样保留（会话中新建）；超过 SNAPSHOT_MAX_CHARS 的超大文件
// 返回 undefined（不存快照 → 显示回退片段 diff、该 op 不可撤回）
function snapOf(v) {
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  if (v.length > SNAPSHOT_MAX_CHARS) return undefined
  return v
}

function splitLines(s) {
  if (s === '') return []
  return s.split('\n')
}

/** 换行符归一（CRLF/CR → LF）：diff 计算与快照比较共用 */
function normLf(s) {
  return String(s).replace(/\r\n?/g, '\n')
}

// ── 文件地址显示：绝对路径（absPath）与仓库相对路径（repoPath）─────────
// 仓库根按 cwd 缓存（git rev-parse --show-toplevel），避免每个请求重复执行
const repoRootCache = new Map()
function repoRootOf(cwd) {
  const key = cwd || process.cwd()
  if (repoRootCache.has(key)) return repoRootCache.get(key)
  let root = ''
  try {
    root = execFileSync('git', ['-C', key, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || ''
  } catch (e) { root = '' }
  repoRootCache.set(key, root)
  return root
}
// 文件的绝对路径（rec.path 通常已是绝对路径，resolve 幂等）
function absPathOf(cwd, raw) {
  return resolvePath(cwd || process.cwd(), raw)
}
// 路径比较键：Windows 下大小写不敏感，统一小写后再比，避免同一文件因大小写
// 差异（或盘符大小写）被当成两个文件。
function pathKeyOf(p) {
  const s = String(p == null ? '' : p)
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** abs 是否落在工作区根之外（用于给文件打「工作区外」标识与筛选）；根为空时返回 false */
function outsideOf(root, abs) {
  if (!root || !abs) return false
  const r = pathKeyOf(resolvePath(root))
  const a = pathKeyOf(resolvePath(abs))
  const sep = process.platform === 'win32' ? '\\' : '/'
  return a !== r && !a.startsWith(r + sep)
}

// 工具标签顺序（固定，UI 显示稳定）：内置工具在前，shell 类在后
const TOOL_LABELS = ['write', 'edit', 'pwsh', 'bash', 'run_code']

/** 该文件的改动来自哪些工具（去重 + 固定顺序）。旧记录没有 via 字段，
 *  按 op.kind 退回 write / edit——那时还区分不了 shell 改动。 */
function toolsOf(ops) {
  const seen = []
  for (const op of ops || []) {
    const t = op && typeof op.via === 'string' && op.via ? op.via : (op && op.kind === 'edit' ? 'edit' : 'write')
    if (t && !seen.includes(t)) seen.push(t)
  }
  seen.sort((a, b) => {
    const ia = TOOL_LABELS.indexOf(a)
    const ib = TOOL_LABELS.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return seen
}

// 按请求里的 path 找记录：精确命中优先（客户端回传的 path 就是 rec.path），其次
// 按大小写不敏感的同名键、再按「绝对路径归一后相同」兜底——路径形态差异（大小写、
// 相对 vs 绝对）不再让 diff 打不开或撤回报「未找到该文件的修改记录」。
function findRecord(files, file) {
  if (!files || !file) return null
  const direct = files.get(file)
  if (direct) return { key: file, rec: direct }
  const want = pathKeyOf(file)
  for (const [key, rec] of files) {
    if (rec && pathKeyOf(key) === want) return { key, rec }
  }
  const wantAbs = pathKeyOf(resolvePath(file))
  for (const [key, rec] of files) {
    if (rec && pathKeyOf(absPathOf(rec.cwd, rec.path || key)) === wantAbs) return { key, rec }
  }
  return null
}

// 旧记录键兼容：同一文件早先可能以相对路径（或大小写不同的路径）存过，记录键
// 归一成绝对路径后要能把它认回来，否则同一文件会出现两条记录（列表重复两行、
// 轮次与统计分裂）。仅在绝对键未命中时调用（记录数很少，全表扫描可忽略）。
function findLegacyKeyOf(files, absKey) {
  const want = pathKeyOf(absKey)
  for (const [key, rec] of files) {
    if (!rec) continue
    if (pathKeyOf(absPathOf(rec.cwd, rec.path || key)) === want) return key
  }
  return ''
}
// ── 文件状态：新增 / 修改 / 删除 ─────────────────────────────────────
// 删除由「当前磁盘上是否还存在」实时判定（宿主是唯一能看磁盘的一侧）：会话内
// 新建后又被删掉、改过又被删掉，都会落到这里；不区分是谁删的——插件只监听
// write/edit，删文件一般走 shell 命令，解析命令不可靠，磁盘才是事实来源。
// 新增 = 会话内首个 op 的 before === null（工具返回值里 before 为 null 即新建，
// 升级前无快照的旧记录是 undefined，落到修改）；相对路径且记录没有 cwd 时无法
// 定位磁盘文件，一律不判删除，避免误报成删除。
function statusOf(rec) {
  try {
    const first = rec && Array.isArray(rec.ops) ? rec.ops[0] : undefined
    const added = !!(first && first.before === null)
    const raw = rec && rec.path
    const isAbs = typeof raw === 'string' && /^([a-zA-Z]:[\\/]|[\\/])/.test(raw)
    if (typeof raw === 'string' && raw !== '' && (rec.cwd || isAbs)) {
      if (!existsSync(absPathOf(rec.cwd, raw))) return 'deleted'
    }
    return added ? 'added' : 'modified'
  } catch (e) {
    return 'modified'
  }
}

// 显示用仓库相对路径（统一 '/' 分隔）；不在 git 仓库时回退相对会话 cwd
function repoPathOf(cwd, raw) {
  const abs = absPathOf(cwd, raw)
  const bases = [repoRootOf(cwd)]
  if (cwd) bases.push(resolvePath(cwd))
  for (const base of bases) {
    if (!base) continue
    const r = resolvePath(base)
    if (abs === r) return ''
    if (abs.startsWith(r + '\\') || abs.startsWith(r + '/')) {
      return abs.slice(r.length + 1).split('\\').join('/')
    }
  }
  return abs.split('\\').join('/')
}

// ── shell 类工具的文件改动发现（2026-09-17）────────────────────────────
// 插件原先只在 tools/result 里看 write/edit，用 pwsh/bash/run_code 直接落盘
// （Set-Content、node 脚本、run_code 里 fs.writeFileSync）的改动一条都拿不到：
// 宿主没有文件变更事件，pwsh 工具的结果也只有 stdout/stderr。办法是在
// tools/pre-execute（命令执行前）与 tools/result（执行后）各取一次文件快照，
// 比对出「这次调用改了哪些文件」再补一条 write op。
// 快照口径：一次 `git status --porcelain -z` 拿仓库内全部变更/未跟踪文件；
// 不在 git 仓库时退化为目录遍历（跳过依赖/产物目录）；另外总是把「本会话已
// 记录过的文件」逐个 stat（它们可能在仓库之外，git 与遍历都看不到）。
const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])
const SNAP_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'venv', '.venv', '__pycache__', '.next', '.nuxt', '.idea', '.vscode', '.cache'])
const SNAP_MAX_FILES = 4000
const SNAP_MAX_CHANGES = 50
const SNAP_BASELINE_TTL = 5 * 60 * 1000

/** 文件「身份」= 大小 + mtime；读不到（不存在/目录）返回空串 */
function statKey(abs) {
  try {
    const s = statSync(abs)
    return s.isFile() ? s.size + ':' + s.mtimeMs : ''
  } catch (e) {
    return ''
  }
}

/** git 仓库内全部变更/未跟踪文件（相对仓库根，'/' 分隔）；不是仓库或无 git 返回 null */
function gitChangedPaths(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '-z', '--untracked-files=all'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
    const parts = out.split('\0')
    const paths = []
    for (let i = 0; i < parts.length && paths.length < SNAP_MAX_FILES; i++) {
      const entry = parts[i]
      if (!entry || entry.length < 4) continue
      const status = entry.slice(0, 2)
      const p = entry.slice(3)
      if (!p) continue
      // rename/copy 的原路径是紧随其后的独立一段，跳过它
      if (status[0] === 'R' || status[0] === 'C') { i++ }
      paths.push(p)
    }
    return paths
  } catch (e) {
    return null
  }
}

/** 目录遍历兜底（非 git 仓库）：有界递归，跳过依赖/产物目录 */
function walkFiles(root, acc, depth) {
  if (acc.length >= SNAP_MAX_FILES || depth > 6) return
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch (e) { return }
  for (const ent of entries) {
    if (acc.length >= SNAP_MAX_FILES) return
    const abs = join(root, ent.name)
    if (ent.isDirectory()) {
      if (SNAP_SKIP_DIRS.has(ent.name)) continue
      walkFiles(abs, acc, depth + 1)
    } else if (ent.isFile()) {
      acc.push(abs)
    }
  }
}

/** 文件快照：Map<绝对路径, statKey>；knownPaths（本会话已记录的文件）总是纳入 */
function snapshotOf(cwd, knownPaths) {
  const map = new Map()
  const listed = cwd ? gitChangedPaths(cwd) : null
  if (listed) {
    for (const rel of listed) {
      const abs = resolvePath(cwd, rel)
      const k = statKey(abs)
      if (k) map.set(abs, k)
    }
  } else if (cwd) {
    const acc = []
    walkFiles(cwd, acc, 0)
    for (const abs of acc) {
      const k = statKey(abs)
      if (k) map.set(abs, k)
    }
  }
  for (const abs of knownPaths || []) {
    if (!abs || map.has(abs)) continue
    const k = statKey(abs)
    if (k) map.set(abs, k)
  }
  return map
}

/** 两次快照的差异文件（路径按大小写不敏感比较，避免同一文件因写法差异重复计入） */
function diffSnapshot(before, after) {
  const base = new Map()
  for (const [p, k] of before) base.set(pathKeyOf(p), k)
  const changed = []
  for (const [p, k] of after) {
    if (base.get(pathKeyOf(p)) !== k) changed.push(p)
    if (changed.length >= SNAP_MAX_CHANGES) break
  }
  return changed
}
/**
 * 超大差异段的分块 LCS：与 diffLines 同形（行号已按块起点补偿），把两侧按固定块宽
 * 切开逐块做 DP。
 *
 * 为什么需要它：整段 LCS 的内存是 (n+1)×(m+1)×4B，几千行就上百 MB，旧实现只能
 * 硬截断（slice 掉后半段 → 内容直接丢）。分块后单块内存恒定 ≈ chunk²×4B，
 * 内容保持完整；代价是块边界无法跨块配对，那里退化为「整块删 + 整块增」。
 */
function diffLinesChunked(a, b, chunkLines) {
  const K = chunkLines || DIFF_CHUNK_LINES
  const out = []
  const total = Math.max(a.length, b.length)
  for (let start = 0; start < total; start += K) {
    for (const r of diffLines(a.slice(start, start + K), b.slice(start, start + K))) {
      out.push({
        type: r.type,
        a: r.a === null ? null : r.a + start,
        b: r.b === null ? null : r.b + start,
        text: r.text
      })
    }
  }
  return out
}

/** Simple LCS line diff -> [{ type: 'ctx'|'del'|'add', a, b, text }] */
function diffLines(a, b) {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const eq = a[i] === b[j]
      dp[i * w + j] = eq
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const out = []
  let pending = []
  function flush() {
    for (const h of pending) out.push(h)
    pending = []
  }
  let i = 0
  let j = 0
  let aNo = 1
  let bNo = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pending.push({ type: 'ctx', a: aNo, b: bNo, text: a[i] })
      i++; j++; aNo++; bNo++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      flush()
      out.push({ type: 'del', a: aNo, b: null, text: a[i] })
      i++; aNo++
    } else {
      flush()
      out.push({ type: 'add', a: null, b: bNo, text: b[j] })
      j++; bNo++
    }
  }
  flush()
  while (i < n) { out.push({ type: 'del', a: aNo, b: null, text: a[i] }); i++; aNo++ }
  while (j < m) { out.push({ type: 'add', a: null, b: bNo, text: b[j] }); j++; bNo++ }
  return out
}

/** 每个变更块前后保留的上下文行数 */
const DIFF_CTX = 2

/**
 * 压缩全文件 diff：只保留变更行及其前后各 DIFF_CTX 行上下文，
 * 其余大量无变化行折叠为一个「省略 N 行」标记，避免整文件堆满视野。
 * 整文件全重写（LCS 无匹配、无任何 ctx 行）时不折叠 —— 所有行都是改动；
 * 整文件新增 / 整文件删除由调用方在构建时提前分流，不会进入这里。
 */
// ctxLines：每个变更块前后保留的上下文行数；缺省用 DIFF_CTX。
// 客户端点击「省略 N 行」时会带更大的 ctx 重新拉取，实现按需展开。
function compactHunks(rows, ctxLines) {
  let ctx = Number.isFinite(ctxLines) ? Math.min(500, Math.max(0, Math.floor(ctxLines))) : DIFF_CTX
  // 防护：行数过多的超大文件放大上下文会让 JSON 载荷失控（整文件进响应），
  // 此时忽略展开请求、退回默认折叠
  if (ctx > DIFF_CTX && rows.length > 20000) ctx = DIFF_CTX
  const hasCtx = rows.some((r) => r.type === 'ctx')
  if (!hasCtx) return rows
  const keep = new Array(rows.length).fill(false)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'ctx') continue
    for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true
  }
  const out = []
  let prev = -1
  for (let i = 0; i < rows.length; i++) {
    if (!keep[i]) continue
    if (prev >= 0 && i - prev > 1) {
      out.push({ type: 'skip', count: i - prev - 1 })
    } else if (prev < 0 && i > 0) {
      // 文件头部被跳过的无变化行也给出省略提示
      out.push({ type: 'skip', count: i })
    }
    out.push(rows[i])
    prev = i
  }
  // 文件尾部被跳过的无变化行
  if (prev >= 0 && rows.length - 1 - prev > 0) out.push({ type: 'skip', count: rows.length - 1 - prev })
  return out
}

/**
 * 基于完整前后快照构建 diff 行：截断超长差异段、折叠无变化上下文。
 * before === null 表示会话中新建文件（视为空旧内容，输出全量新增）。
 * 超长文件先剥离公共前缀/后缀（O(n+m)），只对中间差异段做 LCS——避免
 * 一刀切 slice(0, MAX_DIFF_LINES) 截掉头部、丢失发生在文件尾部的修改
 * （planExamine.js 1972 行、修改在第 1715 行被截断后 diff 空白不显示的教训）。
 */
function buildSnapshotHunks(before, after, ctxLines) {
  // 任一侧是二进制内容（PNG 等）就不做文本 diff，只回一行说明
  if (looksBinaryText(before) || looksBinaryText(after)) {
    return { hunks: [{ type: 'ctx', a: 1, b: 1, text: BINARY_NOTICE }], truncated: false }
  }
  // 统一换行符：工具返回的快照通常 LF，而磁盘文件可能是 CRLF；
  // 不归一化会导致逐行比较全部不匹配（无上下文行可折叠，diff 退化为整段删除+整段新增）。
  const oldL = splitLines(normLf(before === null ? '' : before))
  const newL = splitLines(normLf(after))
  // 公共前缀/后缀剥离（逐行相等即相同，O(n+m)）
  let p = 0
  while (p < oldL.length && p < newL.length && oldL[p] === newL[p]) p++
  let s = 0
  while (s < oldL.length - p && s < newL.length - p && oldL[oldL.length - 1 - s] === newL[newL.length - 1 - s]) s++
  const midOld = oldL.slice(p, oldL.length - s)
  const midNew = newL.slice(p, newL.length - s)
  let truncated = false
  let mo = midOld
  let mn = midNew
  // 中间差异段超过 DP 预算时**不再截断**：双侧都有内容改走分块 LCS，内存按块封顶、内容完整；
  // 单侧为空（新建/整文件重写/纯增纯删）本来就没有 DP 成本。
  // 只有连分块都做不动（超过 MAX_WHOLE_LINES）才真的截断，并在段头显示「内容过长已截断」。
  const bothSides = mo.length > 0 && mn.length > 0
  const limit = bothSides ? MAX_DIFF_LINES : MAX_WHOLE_LINES
  const overLimit = mo.length > limit || mn.length > limit
  if (mo.length > MAX_WHOLE_LINES || mn.length > MAX_WHOLE_LINES) {
    truncated = true
    mo = mo.slice(0, MAX_WHOLE_LINES)
    mn = mn.slice(0, MAX_WHOLE_LINES)
  }
  // 组装输出行：前缀 ctx（绝对行号）+ 中间差异（行号偏移 p）+ 后缀 ctx
  const rows = []
  for (let i = 0; i < p; i++) rows.push({ type: 'ctx', a: i + 1, b: i + 1, text: oldL[i] })
  if (mo.length === 0 && mn.length === 0) {
    // 前后快照无差异（防御性；正常不会发生）
  } else if (mo.length === 0) {
    for (let k = 0; k < mn.length; k++) rows.push({ type: 'add', a: null, b: p + k + 1, text: mn[k] })
  } else if (mn.length === 0) {
    for (let k = 0; k < mo.length; k++) rows.push({ type: 'del', a: p + k + 1, b: null, text: mo[k] })
  } else {
    // 双侧都有内容：常规段整段 LCS；超预算的大段走分块 LCS（块边界退化为整块增删）
    for (const r of (overLimit ? diffLinesChunked(mo, mn) : diffLines(mo, mn))) {
      rows.push({ type: r.type, a: r.a === null ? null : r.a + p, b: r.b === null ? null : r.b + p, text: r.text })
    }
  }
  const oldTailStart = oldL.length - s
  const newTailStart = newL.length - s
  for (let k = 0; k < s; k++) {
    rows.push({ type: 'ctx', a: oldTailStart + k + 1, b: newTailStart + k + 1, text: oldL[oldTailStart + k] })
  }
  // 折叠无变化上下文（前缀/后缀中远离变更的行同样折叠为「省略 N 行」）；
  // ctxLines 由调用方透传（客户端展开请求会带更大的值）
  return { hunks: compactHunks(rows, ctxLines), truncated }
}

/**
 * Line diff returning hunks [{a0,a1,b0,b1}]: lines a[a0..a1) are replaced by
 * b[b0..b1). Consecutive del/add runs are grouped into a single hunk.
 */
function diffHunks(a, b) {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    const row = i * w
    const next = (i + 1) * w
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] = a[i] === b[j] ? dp[next + j + 1] + 1 : Math.max(dp[next + j], dp[row + j + 1])
    }
  }
  const hunks = []
  let i = 0
  let j = 0
  let a0 = -1
  let a1 = -1
  let b0 = -1
  let b1 = -1
  const close = () => {
    if (a0 >= 0) hunks.push({ a0, a1, b0, b1 })
    a0 = -1
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      close(); i++; j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      if (a0 < 0) { a0 = i; b0 = j }
      a1 = i + 1
      b1 = j
      i++
    } else {
      if (a0 < 0) { a0 = i; b0 = j }
      a1 = i
      b1 = j + 1
      j++
    }
  }
  close()
  if (i < n) {
    const prev = hunks[hunks.length - 1]
    if (prev && prev.a1 === i && prev.b1 === m) prev.a1 = n
    else hunks.push({ a0: i, a1: n, b0: m, b1: m })
  } else if (j < m) {
    const prev = hunks[hunks.length - 1]
    if (prev && prev.a1 === n && prev.b1 === j) prev.b1 = m
    else hunks.push({ a0: n, a1: n, b0: j, b1: m })
  }
  return hunks
}

/**
 * 3-way line merge: start from `base`, keep `ours`' changes, apply
 * `theirs`' changes. Throws when both touch the same base lines.
 */
function merge3(base, ours, theirs) {
  const ho = diffHunks(base, ours)
  const ht = diffHunks(base, theirs)
  for (const o of ho) {
    for (const t of ht) {
      if (o.a0 < t.a1 && t.a0 < o.a1) {
        throw new Error('该项修改与之后的修改有重叠，无法单独撤回；可尝试撤回整个文件，或从最后一项开始逐项撤回')
      }
    }
  }
  const items = []
  for (const h of ho) items.push({ h, src: ours })
  for (const h of ht) items.push({ h, src: theirs })
  items.sort((x, y) => x.h.a0 - y.h.a0)
  const out = []
  let pos = 0
  for (const it of items) {
    const h = it.h
    for (let k = pos; k < h.a0; k++) out.push(base[k])
    for (let k = h.b0; k < h.b1; k++) out.push(it.src[k])
    pos = h.a1
  }
  for (let k = pos; k < base.length; k++) out.push(base[k])
  return out
}

/** Collect a JSON request body (capped at 1MB). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let tooBig = false
    req.on('data', (chunk) => {
      if (tooBig) return
      data += chunk
      if (data.length > 1e6) {
        tooBig = true
        reject(new Error('请求体过大'))
      }
    })
    req.on('end', () => {
      if (tooBig) return
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (e) {
        reject(new Error('请求体不是有效的 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Restore a file: null content deletes it (was created in-session), string rewrites it. */
async function applyRestore(absPath, content) {
  if (content === null) {
    try {
      await unlink(absPath)
    } catch (e) {
      if (!(e && e.code === 'ENOENT')) throw e
    }
  } else {
    await writeFile(absPath, content, 'utf8')
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// ── persistence: review records survive dsh restarts ──────────────
// 每个会话一个独立文件：$DSH_HOME/diff-review/<sessionId>.json（UI 偏好存
// $DSH_HOME/diff-review/ui/<sessionId>.json），查询按需懒加载、变更只重写
// 该会话的小文件——替代早期「全部会话打包进一个 diff-review-state.json」
// 的做法（那个文件会涨到几十 MB，任何一处小改动都要全量重写，且删除的
// 会话永久残留）。
// 状态根固定在 Harness 家目录 $DSH_HOME：同一 harness 下所有 profile
// （web/desktop/headless）读写同一份审查数据，切换 profile 也能看到同一
// 会话的修改记录；DSH_HOME 未设置（纯 CLI 启动）时回退 ~/.dsh，行为与
// 旧版一致。跨根搬迁已在 2026-09-17 整体删除（它用 rename 把真实数据搬进
// $DSH_HOME，曾造成一次记录全丢）；只有旧版单一大文件仍会在启动时拆分为
// 每会话文件并改名 .bak-migrated 备份。
const STATE_DIR_NAME = 'diff-review'
const LEGACY_STATE_FILE = 'diff-review-state.json'
const DSH_HOME_DIR_NAME = '.dsh'

// Harness 家目录解析：优先读托管环境变量 DSH_HOME（桌面端启动器注入宿主
// 进程），未设置或仅空白时回退 ~/.dsh——与 @deepseek-ai/dsh-home-paths
// 的 resolveDshHome 优先级（显式路径 > $DSH_HOME > ~/.dsh）保持一致
function dshHomePath() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim()
  }
  return join(homedir(), DSH_HOME_DIR_NAME)
}

// 统一状态根：$DSH_HOME/diff-review（DSH_HOME 未设置时回退 ~/.dsh/diff-review）
function stateDirPath() {
  return join(dshHomePath(), STATE_DIR_NAME)
}

// 旧版单一大文件统一查找 $DSH_HOME/diff-review-state.json（迁移用）
function legacyStateFilePath() {
  return join(dshHomePath(), LEGACY_STATE_FILE)
}

// sessionId 直接用作文件名，清洗非法字符防目录逃逸（正常格式 session-uuid 不受影响）
function safeSessionKey(sid) {
  return String(sid).replace(/[^a-zA-Z0-9._-]/g, '_') || 'default'
}

function sessionFileOf(sid) {
  return join(stateDirPath(), safeSessionKey(sid) + '.json')
}

// ── UI 偏好（面板高度等）：按会话独立存放 diff-review/ui/<sessionId>.json ──
// 不能用浏览器 localStorage：Web GUI 端口每次重启都变，origin 隔离导致存的
// 偏好随端口丢失；放 Host 端文件则跨端口、跨重启稳定，且各会话互不影响。
function uiPrefsFileOf(sid) {
  return join(stateDirPath(), 'ui', safeSessionKey(sid) + '.json')
}

function readUiPrefs(sid) {
  try {
    const data = JSON.parse(readFileSync(uiPrefsFileOf(sid), 'utf8'))
    return (data && typeof data === 'object') ? data : {}
  } catch (e) {
    return {}
  }
}

function writeUiPrefs(sid, patch) {
  try {
    const prefs = readUiPrefs(sid)
    Object.assign(prefs, patch, { savedAt: Date.now() })
    mkdirSync(dirname(uiPrefsFileOf(sid)), { recursive: true })
    writeFileSync(uiPrefsFileOf(sid), JSON.stringify({ version: 1, ...prefs }), 'utf8')
  } catch (e) {}
}

// 单会话序列化：{ version, savedAt, files: { <path>: { path, cwd, ops } } }
function serializeSessionFiles(files) {
  const fileOut = {}
  for (const [path, rec] of files) {
    if (!rec || !Array.isArray(rec.ops) || rec.ops.length === 0) continue
    fileOut[path] = { path: rec.path, cwd: rec.cwd, ops: rec.ops }
  }
  return { version: 1, savedAt: Date.now(), files: fileOut }
}

// 写单个会话文件；files 为空时删除该会话文件（清空/无记录不残留）
function persistSession(sid, files) {
  try {
    const file = sessionFileOf(sid)
    if (!files || files.size === 0) {
      try { unlinkSync(file) } catch (e) {}
      return
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(serializeSessionFiles(files)), 'utf8')
  } catch (e) {}
}

// 读单个会话文件；不存在/损坏返回 null
function loadSessionFile(sid) {
  try {
    const data = JSON.parse(readFileSync(sessionFileOf(sid), 'utf8'))
    if (!data || data.version !== 1 || !data.files || typeof data.files !== 'object') return null
    const files = new Map()
    for (const [path, rec] of Object.entries(data.files)) {
      if (!rec || !Array.isArray(rec.ops)) continue
      const ops = rec.ops.filter((op) => op && (op.kind === 'edit' || op.kind === 'write'))
      if (ops.length === 0) continue
      files.set(path, { path: rec.path || path, cwd: typeof rec.cwd === 'string' ? rec.cwd : undefined, ops })
    }
    return files.size > 0 ? files : null
  } catch (e) {
    return null
  }
}

// 一次性迁移：旧版全部打包的单文件拆成每会话文件后改名备份（幂等：迁移后旧文件已不在）
function migrateLegacyState() {
  const legacyFile = legacyStateFilePath()
  if (!existsSync(legacyFile)) return
  try {
    const data = JSON.parse(readFileSync(legacyFile, 'utf8'))
    if (data && data.version === 1 && data.sessions && typeof data.sessions === 'object') {
      for (const [sid, s] of Object.entries(data.sessions)) {
        if (!s || !s.files || typeof s.files !== 'object') continue
        const files = new Map()
        for (const [path, rec] of Object.entries(s.files)) {
          if (!rec || !Array.isArray(rec.ops)) continue
          const ops = rec.ops.filter((op) => op && (op.kind === 'edit' || op.kind === 'write'))
          if (ops.length === 0) continue
          files.set(path, { path: rec.path || path, cwd: typeof rec.cwd === 'string' ? rec.cwd : undefined, ops })
        }
        if (files.size > 0) persistSession(sid, files)
      }
    }
    // 迁移完成：旧文件改名备份，避免下次启动重复迁移
    renameSync(legacyFile, legacyFile + '.bak-migrated')
  } catch (e) {
    // 旧文件损坏：保留原样不动，直接启用每会话存储
  }
}


function apply(ctx) {
  // agent/session id -> path -> { path, cwd, ops }
  const sessions = new Map()
  const clients = new Set()
  // Persistence: 每个会话一个独立文件（$DSH_HOME/diff-review/<sessionId>.json，
  // DSH_HOME 未设置时回退 ~/.dsh）。查询时按需懒加载、变更只重写对应会话
  // 的小文件，记录随重启保留；旧版单一大文件在启动时一次性拆分（不再有跨根搬迁）。
  migrateLegacyState()
  const dirtySessions = new Set()
  let saveTimer = null
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      for (const sid of dirtySessions) persistSession(sid, sessions.get(sid) || null)
      dirtySessions.clear()
    }, 800)
  }
  function markDirty(sid) {
    dirtySessions.add(sid)
    scheduleSave()
  }
  // 按需加载某会话的修改记录：内存没有才读磁盘上对应的会话文件
  function sessionFilesOf(sid) {
    if (sessions.has(sid)) return sessions.get(sid) || null
    const loaded = loadSessionFile(sid)
    if (loaded) sessions.set(sid, loaded)
    return loaded
  }
  ctx.effect(() => () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    dirtySessions.clear()
    // 退出兜底：把内存中全部会话落盘
    for (const sid of sessions.keys()) persistSession(sid, sessions.get(sid) || null)
  }, 'diff-review: persist flush')
  // session id -> { turn, scanSeq }; ops are tagged with the ROOT session's
  // current turn so the client can show per-turn reviews. The turn is derived
  // by scanning the session log tail (position-cached), which is self-consistent
  // and covers resumed sessions whose restored turn/start events never dispatch.
  const turnCursor = new Map()

  // ── 会话与事件日志访问适配 ────────────────────────────────────────────
  // dsh-session 的 Session 只暴露 snapshotEvents()/ownEvents() 方法，没有
  // session.events 属性：旧写法取到 undefined 被 Array.isArray 挡掉后静默
  // 退化为「无日志」，轮次与每轮问题全部为空（op.turn 恒为 0）。会话实例
  // 优先走公开 API ctx.agents.get(id)（返回 Agent，其 .session 是 Session），
  // 兜底内部注册表条目 entry.agent.session。
  function isSessionLike(session) {
    return !!session && (typeof session.snapshotEvents === 'function' || Array.isArray(session.events))
  }
  function sessionOf(rootId) {
    if (!rootId) return null
    try {
      const viaGet = ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(rootId) : null
      const session = viaGet && (viaGet.session || viaGet)
      if (isSessionLike(session)) return session
    } catch (e) {}
    try {
      const entry = ctx.agents && ctx.agents.store && ctx.agents.store.get(rootId)
      const session = entry && entry.agent && entry.agent.session
      if (isSessionLike(session)) return session
    } catch (e) {}
    return null
  }
  // 会话事件日志（seq 升序）。snapshotEvents() 是当前 API；旧版 Session 的
  // events 属性作为兼容分支保留；两者都取不到时返回 null（调用方按无日志处理）。
  function eventsOf(session) {
    if (!session) return null
    try {
      const all = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : null
      if (Array.isArray(all)) return all
    } catch (e) {}
    return Array.isArray(session.events) ? session.events : null
  }

  function currentTurnOf(rootId) {
    let cur = turnCursor.get(rootId)
    if (!cur) {
      // turn：当前「进行中」的轮次（命中 turn/end 归零），用于给 op.turn 打标；
      // lastStarted：最近一次「已开始」的轮次（turn/end 后不清零），审查列表按它
      // 取数——新一轮即使还没有任何文件变更，也必须让列表切过去刷新，不能继续
      // 显示上一轮的旧列表。
      cur = { turn: null, lastStarted: 0, scanSeq: 0 }
      turnCursor.set(rootId, cur)
    }
    try {
      const events = eventsOf(sessionOf(rootId))
      if (events && events.length > cur.scanSeq) {
        const from = cur.scanSeq
        cur.scanSeq = events.length
        // 反向扫描：最新的标记决定「进行中的轮次」；若是 turn/end（该轮已结束，
        // turn 归零）则继续往前找这一轮的 turn/start，供 lastStarted 使用
        let sawMarker = false
        for (let i = events.length - 1; i >= from; i--) {
          const e = events[i]
          if (e.type === 'turn/start') {
            const t = e.data && e.data.turn
            if (!sawMarker) {
              cur.turn = t
              sawMarker = true
            }
            if (typeof t === 'number' && t > cur.lastStarted) { cur.lastStarted = t }
            break
          }
          if (e.type === 'turn/end') {
            if (!sawMarker) {
              cur.turn = null
              sawMarker = true
            }
          }
        }
      }
    } catch (e) {}
    return typeof cur.turn === 'number' && cur.turn > 0 ? cur.turn : 0
  }

  // 最近一次「已开始」的轮次号（含已经结束的轮次）；会话日志里没有任何
  // turn/start 时返回 0（旧记录/无日志），调用方自行退回「最近有记录的轮次」。
  // 借用 currentTurnOf 的同一次扫描推进游标，不重复遍历事件。
  function lastStartedTurnOf(rootId) {
    currentTurnOf(rootId)
    const cur = turnCursor.get(rootId)
    return cur && typeof cur.lastStarted === 'number' ? cur.lastStarted : 0
  }

  // ── 旧记录轮次回填 ───────────────────────────────────────────────────
  // 修复前落盘的记录 op.turn 全是 0；会话日志里的 turn/start 事件带 time
  // 时间戳（Date.now()，与 op.at 同钟），故按「op.at 落在哪一轮」反推：
  // 取最后一个 start <= at 的轮次。时间线按事件条数缓存，随新事件失效。
  const turnTimelineCache = new Map()
  function turnTimelineOf(rootId) {
    const events = eventsOf(sessionOf(rootId))
    if (!events) return null
    const cached = turnTimelineCache.get(rootId)
    if (cached && cached.seq === events.length) return cached.list
    const list = []
    for (const e of events) {
      if (e && e.type === 'turn/start' && e.data && typeof e.data.turn === 'number') {
        list.push({ turn: e.data.turn, start: typeof e.time === 'number' ? e.time : 0 })
      }
    }
    list.sort((a, b) => a.start - b.start)
    turnTimelineCache.set(rootId, { seq: events.length, list })
    return list
  }

  // op 的轮次：写入时打的标记优先（准确），为 0 的旧记录按时间戳回填
  function opTurn(rootId, op) {
    if (op && typeof op.turn === 'number' && op.turn > 0) return op.turn
    const at = op && typeof op.at === 'number' ? op.at : 0
    if (!at || !rootId) return 0
    const list = turnTimelineOf(rootId)
    if (!list || list.length === 0) return 0
    let turn = 0
    for (const item of list) {
      if (item.start <= at) turn = item.turn
      else break
    }
    return turn
  }

  // 每轮用户问题：从会话日志扫出该轮（turn/start 到 turn/end 间）第一条
  // 真实用户 user/message 的文本，供修改记录展示；带进程内缓存。
  const turnQuestionCache = new Map()
  // user/message 的 data.content 可能是字符串，也可能是 ContentBlock 数组（text 块）
  function textOfContent(c) {
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c.map((b) => (typeof b === 'string' ? b : (b && typeof b.text === 'string' ? b.text : ''))).join('')
    }
    if (c && typeof c.text === 'string') return c.text
    return ''
  }
  function questionOf(rootId, turnNo) {
    const key = rootId + ':' + turnNo
    if (turnQuestionCache.has(key)) return turnQuestionCache.get(key)
    let q = ''
    try {
      const events = eventsOf(sessionOf(rootId))
      if (Array.isArray(events)) {
        let inTurn = false
        for (let i = 0; i < events.length; i++) {
          const e = events[i]
          if (e.type === 'turn/start') { inTurn = (e.data && e.data.turn) === turnNo }
          else if (e.type === 'turn/end') { if (inTurn) break }
          else if (inTurn && e.type === 'user/message') {
            const d = e.data || {}
            // 只要用户真实提问，跳过插件/压缩/目标等注入的 user/message
            if (d.source && d.source.kind && d.source.kind !== 'user') continue
            const t = textOfContent(d.content || (d.message && d.message.content)) || ''
            if (t.trim()) { q = t.trim().slice(0, 120); break }
          }
        }
      }
    } catch (e) {}
    turnQuestionCache.set(key, q)
    return q
  }

  function filesOf(agentId) {
    // 先按需加载磁盘上已有的该会话记录，避免内存新建空 Map 覆盖丢历史
    let files = sessionFilesOf(agentId)
    if (!files) { files = new Map(); sessions.set(agentId, files) }
    return files
  }

  /** 会话工作区根（会话 cwd）：文件项用它判定「工作区外」；取不到时返回空串（不判外） */
  function workspaceRootOf(rootId) {
    try {
      const session = sessionOf(rootId)
      const cwd = session && session.header && session.header.cwd
      return typeof cwd === 'string' ? cwd : ''
    } catch (e) {
      return ''
    }
  }

  function broadcast(agentId) {
    const payload = 'data: ' + JSON.stringify({ session: agentId }) + '\n\n'
    for (const res of clients) {
      try { res.write(payload) } catch (e) { clients.delete(res) }
    }
  }

  // Walk the live owner chain up to the root session so subagent changes
  // aggregate into the top-level parent session the user views.
  function resolveRootId(agentId) {
    const store = ctx.agents && ctx.agents.store
    if (!store) return agentId
    let current = store.get(agentId)
    if (!current) return agentId
    const seen = new Set()
    while (current.owner) {
      const oid = current.owner.id
      if (!oid || seen.has(oid)) break
      seen.add(oid)
      const next = store.get(oid)
      if (!next) break
      current = next
    }
    return current.agent ? current.agent.id : agentId
  }

  // ── shell 类工具的文件改动发现 ───────────────────────────────────────
  // 基线按 callId 关联：pre-execute 取一次快照，tools/result 时再取一次做差
  const shellBaselines = new Map()

  /** 本会话已记录过的文件（绝对路径）：它们可能在仓库之外（例如 $DSH_HOME），
   *  git status 与目录遍历都看不到，只能逐个 stat 纳入快照。
   *  只读内存里的会话（不触发磁盘加载）：pre-execute 在每个 shell 调用前都会走
   *  这里，按需加载会把几 MB 的状态文件读成常态开销。 */
  function knownPathsOf(rootId) {
    if (!rootId) return []
    const files = sessions.get(rootId)
    if (!files) return []
    const out = []
    for (const rec of files.values()) {
      if (rec && typeof rec.path === 'string') out.push(absPathOf(rec.cwd, rec.path))
    }
    return out
  }

  /** 首次由 shell 改动的文件：用 git HEAD 版本当 before；拿不到（未跟踪/未提交/不在仓库）返回 undefined */
  function headContentOf(cwd, abs) {
    try {
      const root = repoRootOf(cwd)
      if (!root) return undefined
      const target = resolvePath(abs)
      const base = resolvePath(root)
      const sep = process.platform === 'win32' ? '\\' : '/'
      // Windows 路径大小写不敏感：前缀判断用归一化键（盘符/用户名大小写常与 git 输出不一致）
      if (!pathKeyOf(target).startsWith(pathKeyOf(base) + sep)) return undefined
      const rel = target.slice(base.length + 1).split('\\').join('/')
      return execFileSync('git', ['-C', base, 'show', 'HEAD:' + rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: SNAPSHOT_MAX_CHARS * 2 })
    } catch (e) {
      return undefined
    }
  }

  /** 把两次快照之间的文件变化补成 write op；与记录里最后一份内容相同的跳过，
   *  避免与 write/edit 路径重复记（run_code 内部再调 write 工具时会两条路径同时触发）。
   *  via 记下是哪个 shell 工具改的（pwsh / bash / run_code），供 UI 打工具标签；
   *  内置工具不写 via，由 op.kind（write / edit）区分。 */
  function recordShellChanges(agentId, cwd, before, via) {
    try {
      const rootId = resolveRootId(agentId)
      const files = filesOf(rootId)
      // 这里已握有完整记录（可能刚从磁盘加载），用它取「已记录文件」全量：这些
      // 路径可能在仓库之外，只有逐个 stat 才能发现它们被 shell 改过
      const known = []
      for (const rec of files.values()) {
        if (rec && typeof rec.path === 'string') known.push(absPathOf(rec.cwd, rec.path))
      }
      const after = snapshotOf(cwd, known)
      const changed = diffSnapshot(before, after)
      if (changed.length === 0) return
      const at = Date.now()
      const turn = currentTurnOf(rootId)
      let recorded = 0
      for (const abs of changed) {
        let content = ''
        try {
          if (statSync(abs).size > SNAPSHOT_MAX_CHARS) continue
          content = readFileSync(abs, 'utf8')
        } catch (e) {
          // 读不到（刚被删/无权限）不补：删除态交给 statusOf 按磁盘实时反映
          continue
        }
        const value = snapOf(content)
        if (value === undefined) continue
        let rec = files.get(abs)
        if (!rec) {
          const legacyKey = findLegacyKeyOf(files, abs)
          if (legacyKey) {
            rec = files.get(legacyKey)
            files.delete(legacyKey)
            rec.path = absPathOf(rec.cwd, rec.path || legacyKey)
            files.set(rec.path, rec)
          }
        }
        if (!rec) {
          rec = { path: abs, cwd, ops: [] }
          files.set(abs, rec)
        }
        const prev = rec.ops.length > 0 ? rec.ops[rec.ops.length - 1].after : undefined
        if (prev !== undefined && prev === value) continue
        const head = prev === undefined ? headContentOf(cwd, abs) : undefined
        const beforeValue = prev !== undefined ? prev : (head === undefined ? null : snapOf(head))
        if (rec.ops.length >= MAX_OPS) rec.ops.shift()
        rec.ops.push({ kind: 'write', at, turn, before: beforeValue, after: value, content: cap(content), via: via || 'shell' })
        recorded++
      }
      if (recorded > 0) {
        broadcast(rootId)
        markDirty(rootId)
      }
    } catch (e) {
      console.error('diff-review shell track failed', e)
    }
  }

  // 命令执行前取基线；waterfall 语义：无论快照成败都必须放行工具
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = exec && (exec.name || exec.tool)
      if (SHELL_TOOLS.has(toolName)) {
        const now = Date.now()
        // 工具被拦下时不会有 tools/result，过期基线在这里顺手清掉
        for (const [id, item] of shellBaselines) {
          if (now - item.at > SNAP_BASELINE_TTL) shellBaselines.delete(id)
        }
        const callId = exec.callId || exec.rootCallId
        const agentId = exec.agent && exec.agent.id
        if (callId && agentId) {
          const cwd = exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
          shellBaselines.set(callId, { cwd, snap: snapshotOf(cwd, knownPathsOf(resolveRootId(agentId))), at: now })
        }
      }
    } catch (e) {
      // 快照失败不能影响工具执行
    }
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    try {
      if (!exec) return
      const toolName = exec.tool || exec.name
      // shell 类工具：结果里没有文件清单，用「执行前/后」两次快照的差补记录
      if (SHELL_TOOLS.has(toolName)) {
        const callId = exec.callId || exec.rootCallId
        const base = callId ? shellBaselines.get(callId) : null
        if (base) {
          shellBaselines.delete(callId)
          const shellAgentId = exec.agent && exec.agent.id
          // 放到下一拍：不跟工具结果处理抢时间，也让文件 mtime/size 稳定下来
          if (shellAgentId) setImmediate(() => recordShellChanges(shellAgentId, base.cwd, base.snap, toolName))
        }
        return
      }
      if (toolName !== 'write' && toolName !== 'edit') return
      const input = exec.input || exec.arguments || exec.args
      if (!input || typeof input !== 'object') return
      const file = input.file_path || input.file || input.path
      if (!file) return
      const agentId = exec.agent && exec.agent.id
      if (!agentId) return
      const failed = result && (result.isError || result.error || result.ok === false || result.failed)
      if (failed) return
      const rootId = resolveRootId(agentId)
      const at = Date.now()
      const turn = currentTurnOf(rootId)
      const files = filesOf(rootId)
      // 记录键归一：file_path 既可能给相对路径也可能给绝对路径，旧实现原样当 Map
      // 键 → 同一文件分裂成两条记录。统一用绝对路径作键（下同，path 也写绝对）。
      const cwd = exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
      const key = absPathOf(cwd, file)
      let rec = files.get(key)
      if (!rec) {
        // 兼容旧记录：认领指向同一文件的旧键（相对/绝对、大小写差异）并迁移，
        // 让历史 op 与新 op 落入同一条记录
        const legacyKey = findLegacyKeyOf(files, key)
        if (legacyKey) {
          rec = files.get(legacyKey)
          files.delete(legacyKey)
          // 迁移成绝对路径，但沿用旧记录的写法（大小写/分隔符形态），避免同一
          // 文件在写法不同的写入之间来回换键
          const canonical = absPathOf(rec.cwd, rec.path || legacyKey)
          rec.path = canonical
          files.set(canonical, rec)
        }
      }
      if (!rec) {
        rec = { path: key, cwd, ops: [] }
        files.set(key, rec)
      }
      if (rec.ops.length >= MAX_OPS) rec.ops.shift()
      // The write/edit success payload carries the full before/after content,
      // which is exactly what revert needs. before === null -> file created.
      const value = result && !result.isError && result.value && typeof result.value === 'object' ? result.value : null
      const hasBefore = value !== null && 'before' in value
      const hasAfter = value !== null && 'after' in value
      const before = hasBefore ? snapOf(value.before) : undefined
      const after = hasAfter ? snapOf(value.after) : undefined
      if (toolName === 'edit') {
        rec.ops.push({ kind: 'edit', at, turn, before, after, oldString: cap(input.old_string), newString: cap(input.new_string) })
      } else {
        rec.ops.push({ kind: 'write', at, turn, before, after, content: cap(input.content) })
      }
      broadcast(rootId)
      markDirty(rootId)
    } catch (e) {
      console.error('diff-review track failed', e)
    }
  })

  // 新轮次开始 → 立刻广播一次，让审查列表切到新一轮并刷新：本轮此时可能一个文件
  // 都还没改（旧实现只在「记录到改动」时广播，于是新一轮开始后列表一直停在上一轮）。
  // Session 追加事件的顺序是「先入日志、再派发 session/event」（见 dsh-session 的 append），
  // 所以这里广播时 summary 已经能看到这个 turn/start。
  ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'turn/start') return
      const sid = session && typeof session.id === 'string' ? session.id : ''
      if (!sid) return
      broadcast(resolveRootId(sid) || sid)
    } catch (e) {}
  })

  function buildSummary(files, rootId) {
    const items = []
    // 会话工作区根：文件不在其下即为「工作区外」（UI 打标识并支持筛选）
    const workspace = workspaceRootOf(rootId)
    for (const rec of files.values()) {
      let added = 0
      let removed = 0
      let writes = 0
      let edits = 0
      for (const op of rec.ops) {
        if (op.kind === 'edit') {
          edits++
          added += splitLines(op.newString).length
          removed += splitLines(op.oldString).length
        } else {
          writes++
          added += splitLines(op.content).length
        }
      }
      const last = rec.ops[rec.ops.length - 1]
      // 该文件是否支持「撤回全部改回首次修改前」：首个 op 记录了修改前快照
      const first = rec.ops[0]
      // 收集该文件被修改的轮次（opTurn 解析：记录时标记 + 旧记录时间线回填，
      // 去重排序），供 UI 标注“第几轮变更”
      const turns = []
      for (const op of rec.ops) {
        const t = opTurn(rootId, op)
        if (t > 0 && !turns.includes(t)) turns.push(t)
      }
      turns.sort((x, y) => x - y)
      items.push({
        path: rec.path,
        name: String(rec.path).split('/').pop(),
        cwd: rec.cwd,
        ops: rec.ops.length,
        writes,
        edits,
        added,
        removed,
        turn: last ? opTurn(rootId, last) : 0,
        turns,
        // 文件状态：新增 / 修改 / 删除（删除按磁盘是否存在实时判定）
        status: statusOf(rec),
        revertible: !!(first && first.before !== undefined),
        lastTime: last ? last.at : 0,
        absPath: absPathOf(rec.cwd, rec.path),
        repoPath: repoPathOf(rec.cwd, rec.path),
        outside: outsideOf(workspace, absPathOf(rec.cwd, rec.path)),
        // 该文件的改动来自哪些工具（write / edit / pwsh / bash / run_code），供 UI 打标签
        tools: toolsOf(rec.ops)
      })
    }
    items.sort((x, y) => y.lastTime - x.lastTime)
    let latestTurn = 0
    for (const rec of files.values()) {
      for (const op of rec.ops) {
        const t = opTurn(rootId, op)
        if (t > latestTurn) latestTurn = t
      }
    }
    // 当前轮次（审查列表「最新轮次」筛选按它取数）：优先取「会话里最近开始的轮次」
    // ——新一轮开始时可能一个文件都还没改，也必须让列表切到新一轮去刷新，而不是
    // 继续显示上一轮的旧列表；会话日志里没有 turn/start（旧记录）时退回最近有记录的轮次。
    const startedTurn = lastStartedTurnOf(rootId)
    const currentTurn = startedTurn > 0 ? startedTurn : latestTurn
    return { files: items, latestTurn, currentTurn }
  }

  // Build one section per op; 'indices' selects which ops (opIndex is the index
  // into the FULL ops array so /diff-review/revert stays valid).
  function buildSections(ops, indices, rootId, ctxLines) {
    const sections = []
    for (const i of indices) {
      const op = ops[i]
      let section
      if (op.kind === 'edit') {
        // 优先使用工具返回值携带的完整前后快照（before/after）计算 diff：
        // 这样 gutter 行号就是真实文件行号；入参 old_string/new_string 只是
        // 被替换的片段，用它算出的行号与文件实际位置不符。before === null
        // 表示会话中新建文件；快照缺失（升级前的旧记录）回退到入参片段。
        // 另：历史记录里超长文件的快照可能被 MAX_CHARS 截断「抹平」
        // （norm 后 before===after、真实差异在被切掉的尾部）——此时同样回退到
        // 入参片段 diff，保证修改内容可见而非空白。
        let built
        const hasSnap = op.before !== undefined && op.after !== undefined
        const snapFlattened = hasSnap && op.before !== null && op.after !== null
          && normLf(op.before) === normLf(op.after)
        if (hasSnap && !snapFlattened) {
          built = buildSnapshotHunks(op.before, op.after, ctxLines)
        } else {
          const oldL = splitLines(op.oldString)
          const newL = splitLines(op.newString)
          // 同上：双侧非空才走 LCS；超过预算不再截断，改走分块 LCS；
          // 只有超过硬上限 MAX_WHOLE_LINES 才真的截断
          const lim = (oldL.length > 0 && newL.length > 0) ? MAX_DIFF_LINES : MAX_WHOLE_LINES
          const over = oldL.length > lim || newL.length > lim
          let truncated = false
          let o = oldL
          let n = newL
          if (oldL.length > MAX_WHOLE_LINES || newL.length > MAX_WHOLE_LINES) {
            truncated = true
            o = oldL.slice(0, MAX_WHOLE_LINES)
            n = newL.slice(0, MAX_WHOLE_LINES)
          }
          let hunks
          if (o.length === 0) hunks = n.map((t, k) => ({ type: 'add', a: null, b: k + 1, text: t }))
          else if (n.length === 0) hunks = o.map((t, k) => ({ type: 'del', a: k + 1, b: null, text: t }))
          else hunks = over ? diffLinesChunked(o, n) : diffLines(o, n)
          built = (looksBinaryText(op.oldString) || looksBinaryText(op.newString) || looksBinaryText(op.content))
            ? { hunks: [{ type: 'ctx', a: 1, b: 1, text: BINARY_NOTICE }], truncated: false }
            : { hunks, truncated }
        }
        section = { kind: 'edit', at: op.at, hunks: built.hunks, truncated: built.truncated }
      } else {
        // write 覆盖已有文件（快照非空且确有差异）时展示前后 diff（自动折叠）：
        // 一眼看到实际改动并隐藏未修改行；新建文件（before === null）、
        // 升级前旧记录（无快照）、或快照被 MAX_CHARS 截断抹平（norm 相等）
        // 时整体展开新内容，避免空白。
        if (op.before !== undefined && op.before !== null
          && normLf(op.before) !== normLf(op.after)) {
          const built = buildSnapshotHunks(op.before, op.after, ctxLines)
          section = { kind: 'write', at: op.at, wholeFile: true, truncated: built.truncated, hunks: built.hunks }
        } else {
          const all = splitLines(op.content)
          let lines = all
          let truncated = false
          // 二进制内容（截图 PNG 之类被当文本记录）不逐行展开，只给一行说明；
          // 其余整文件内容（新建文件 / 无快照可 diff）是纯新增，没有 DP 成本
          if (looksBinaryText(op.content)) {
            lines = [BINARY_NOTICE]
          } else if (all.length > MAX_WHOLE_LINES) {
            truncated = true
            lines = all.slice(0, MAX_WHOLE_LINES)
          }
          section = {
            kind: 'write', at: op.at, wholeFile: true, truncated,
            hunks: lines.map((t, k) => ({ type: 'add', a: null, b: k + 1, text: t }))
          }
        }
      }
      const revertible = op.before !== undefined && op.after !== undefined
      section.opIndex = i
      section.revertible = revertible
      section.canUndo = revertible && (op.before !== null || i === ops.length - 1)
      // 所属轮次与该轮用户问题（供 diff 头部展示）；轮次同样走 opTurn 解析，
      // 旧记录按时间线回填后才能取到该轮问题
      const turnNo = opTurn(rootId || '', op)
      section.turn = turnNo
      section.question = turnNo > 0 ? questionOf(rootId || '', turnNo) : ''
      sections.push(section)
    }
    // 记录按时间先后入列，统一倒序输出：最后修改的记录排列在最上方
    return sections.reverse()
  }

  function statsOf(ops) {
    let added = 0
    let removed = 0
    let writes = 0
    let edits = 0
    for (const op of ops) {
      if (op.kind === 'edit') {
        edits++
        added += splitLines(op.newString).length
        removed += splitLines(op.oldString).length
      } else {
        writes++
        added += splitLines(op.content).length
      }
    }
    return { added, removed, writes, edits }
  }

  function buildDetail(files, file, rootId, ctxLines) {
    const found = findRecord(files, file)
    const rec = found && found.rec
    if (!rec) return { path: file, sections: [] }
    const ops = rec.ops
    const first = ops[0]
    return {
      path: file,
      sections: buildSections(ops, ops.map((_, i) => i), rootId, ctxLines),
      status: statusOf(rec),
      // 侧栏 diff tab 的工具栏要用：记录时的 cwd（打开文件时定位用）、
      // 绝对路径与仓库相对路径（显示/复制用）
      cwd: rec.cwd,
      absPath: absPathOf(rec.cwd, rec.path),
      repoPath: repoPathOf(rec.cwd, rec.path),
      revertible: !!(first && first.before !== undefined)
    }
  }

  // ── 版本对比基准：会话最初版本 / Git HEAD 版本 ──────────────────────
  // 会话最初版本 = 会话首次修改前的内容快照（op[0].before）；null 表示会话中新建。
  function initialBaseOf(ops) {
    const first = ops && ops[0]
    if (!first || first.before === undefined) return { ok: false, reason: '该记录无初始版本快照（升级前的旧记录）' }
    return { ok: true, content: first.before === null ? '' : first.before, created: first.before === null }
  }
  // Git HEAD 版本内容：git show HEAD:<repo 相对路径>；失败（未跟踪/未提交等）返回原因。
  function gitHeadBase(absPath, cwd) {
    try {
      const root = execFileSync('git', ['-C', cwd || process.cwd(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (!root) return { ok: false, reason: '文件不在 Git 仓库中' }
      const relAbs = resolvePath(absPath)
      const rel = relAbs.startsWith(resolvePath(root)) ? relAbs.slice(root.length).replace(/^[\\/]/, '') : absPath
      const out = execFileSync('git', ['-C', root, 'show', 'HEAD:' + rel.split('\\').join('/')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return { ok: true, content: out }
    } catch (e) {
      return { ok: false, reason: '无法读取 Git 版本（文件未跟踪 / 尚未提交 / 不在仓库）' }
    }
  }

  // 与外部版本（会话最初 / Git HEAD）对比：基准内容 vs 当前磁盘内容，走同一套折叠 diff。
  async function handleAgainst(req, res) {
    try {
      const u = new URL(req.url, 'http://localhost')
      const session = u.searchParams.get('session') || ''
      const path = u.searchParams.get('path') || ''
      const mode = u.searchParams.get('mode') || 'initial'
      // ctx：与 /diff-review/file 同款——客户端展开折叠段时传更大的上下文行数
      const ctxRaw = Number(u.searchParams.get('ctx'))
      const ctxLines = Number.isFinite(ctxRaw) ? Math.min(500, Math.max(0, Math.floor(ctxRaw))) : undefined
      let files = sessionFilesOf(session)
      if (!files) {
        const rootId = resolveRootId(session)
        if (rootId !== session && rootId) files = sessionFilesOf(rootId)
      }
      const found = files instanceof Map && path ? findRecord(files, path) : null
      const rec = found && found.rec
      if (!rec) return sendJson(res, 200, { path, mode, sections: [], error: '未找到该文件的修改记录' })
      const absPath = resolvePath(rec.cwd || process.cwd(), path)
      let base = ''
      let baseLabel = ''
      if (mode === 'git') {
        const g = gitHeadBase(absPath, rec.cwd)
        if (!g.ok) return sendJson(res, 200, { path, mode, sections: [], error: g.reason })
        base = g.content
        baseLabel = 'Git HEAD 版本 ←→ 工作区当前内容'
      } else {
        const init = initialBaseOf(rec.ops)
        if (!init.ok) return sendJson(res, 200, { path, mode, sections: [], error: init.reason })
        base = init.content
        baseLabel = init.created ? '会话最初（会话中新建）←→ 当前内容' : '会话最初版本 ←→ 当前内容'
      }
      let current = ''
      try { current = await readFile(absPath, 'utf8') } catch (e) { current = '' }
      const built = buildSnapshotHunks(base, current, ctxLines)
      sendJson(res, 200, { path, mode, baseLabel, sections: [{ kind: 'edit', at: Date.now(), hunks: built.hunks, truncated: built.truncated }], revertible: false })
    } catch (e) {
      sendJson(res, 200, { path: '', mode: '', sections: [], error: '对比失败：' + String((e && e.message) || e) })
    }
  }

  // Per-turn payload: files with at least one op tagged to 'turn', with only
  // that turn's ops in the sections (opIndex still indexes the full ops array).
  function buildTurn(files, turn, rootId) {
    const items = []
    const workspace = workspaceRootOf(rootId)
    for (const rec of files.values()) {
      const indices = []
      for (let i = 0; i < rec.ops.length; i++) {
        if (opTurn(rootId, rec.ops[i]) === turn) indices.push(i)
      }
      if (indices.length === 0) continue
      const ops = indices.map((i) => rec.ops[i])
      const stats = statsOf(ops)
      const last = ops[ops.length - 1]
      // 该文件涉及的轮次（去重），供文件行「第 N 轮」徽章展示
      const turns = []
      for (const o of ops) { const t = opTurn(rootId, o); if (t > 0 && !turns.includes(t)) turns.push(t) }
      items.push({
        path: rec.path,
        name: String(rec.path).split('/').pop(),
        cwd: rec.cwd,
        ops: ops.length,
        writes: stats.writes,
        edits: stats.edits,
        added: stats.added,
        removed: stats.removed,
        lastTime: last ? last.at : 0,
        turns: turns,
        // 文件状态与 summary 一致：新增 / 修改 / 删除（删除按磁盘实时判定）
        status: statusOf(rec),
        revertible: !!(rec.ops[0] && rec.ops[0].before !== undefined),
        sections: buildSections(rec.ops, indices, rootId),
        absPath: absPathOf(rec.cwd, rec.path),
        repoPath: repoPathOf(rec.cwd, rec.path),
        outside: outsideOf(workspace, absPathOf(rec.cwd, rec.path)),
        tools: toolsOf(ops)
      })
    }
    items.sort((x, y) => y.lastTime - x.lastTime)
    return { turn, files: items }
  }

  function queryParam(req, key) {
    return new URL(req.url, 'http://localhost').searchParams.get(key) || ''
  }

  async function handleRevert(req, res) {
    try {
      const u = new URL(req.url, 'http://localhost')
      const agentId = u.searchParams.get('session') || ''
      const files = sessionFilesOf(agentId)
      const body = await readJsonBody(req)
      const path = body && typeof body.path === 'string' ? body.path : ''
      const opArg = body && body.op !== undefined && body.op !== null ? body.op : null
      const found = files ? findRecord(files, path) : null
      if (!found) {
        return sendJson(res, 400, { ok: false, error: '未找到该文件的修改记录' })
      }
      const rec = found.rec
      // 真正从 Map 里删记录要用找到时的键（可能与请求里的 path 写法不同）
      const recKey = found.key
      const absPath = resolvePath(rec.cwd || process.cwd(), path)
      if (opArg === null) {
        // Whole-file revert: restore the state before the first recorded op.
        const first = rec.ops[0]
        if (!first) return sendJson(res, 400, { ok: false, error: '该文件没有可撤回的修改' })
        if (first.before === undefined) {
          return sendJson(res, 400, { ok: false, error: '该文件的首次修改未记录修改前内容（升级前产生的记录），无法撤回' })
        }
        await applyRestore(absPath, first.before)
        files.delete(recKey)
        broadcast(agentId)
        markDirty(agentId)
        return sendJson(res, 200, {
          ok: true, mode: 'file',
          message: first.before === null ? '已删除本次会话中新建的文件' : '已撤回该文件的全部修改'
        })
      }
      const op = Number(opArg)
      if (!Number.isInteger(op) || op < 0 || op >= rec.ops.length) {
        return sendJson(res, 400, { ok: false, error: '修改项索引无效' })
      }
      const target = rec.ops[op]
      if (target.before === undefined || target.after === undefined) {
        return sendJson(res, 400, { ok: false, error: '该项修改未记录内容快照（升级前产生的记录），无法撤回' })
      }
      if (op === rec.ops.length - 1) {
        // Undo the last op: exact snapshot restore (or delete a created file).
        await applyRestore(absPath, target.before)
      } else {
        // Undo a middle op: 3-way merge of current content with the op's inverse.
        if (target.before === null) {
          return sendJson(res, 400, { ok: false, error: '该项修改新建了文件且之后还有修改，无法单独撤回' })
        }
        const base = splitLines(target.after)
        const ours = splitLines(await readFile(absPath, 'utf8'))
        const theirs = splitLines(target.before)
        if (base.length > MAX_MERGE_LINES || ours.length > MAX_MERGE_LINES || theirs.length > MAX_MERGE_LINES) {
          return sendJson(res, 400, { ok: false, error: '文件过大，无法单独撤回该项' })
        }
        await writeFile(absPath, merge3(base, ours, theirs).join('\n'), 'utf8')
      }
      // The reverted op and everything after it no longer represent pending changes.
      rec.ops = rec.ops.slice(0, op)
      if (rec.ops.length === 0) files.delete(recKey)
      broadcast(agentId)
      markDirty(agentId)
      return sendJson(res, 200, { ok: true, mode: 'op', message: '已撤回该项修改（其后无冲突的修改已保留）' })
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: String((e && e.message) || e) })
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/events',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('retry: 3000\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
    }
  }), 'diff-review: events route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/summary',
    handler: (req, res) => {
      const session = queryParam(req, 'session')
      let files = sessionFilesOf(session)
      if (!files) {
        const rootId = resolveRootId(session)
        if (rootId !== session) files = sessionFilesOf(rootId)
      }
      sendJson(res, 200, buildSummary(files || new Map(), resolveRootId(session) || session))
    }
  }), 'diff-review: summary route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/file',
    handler: (req, res) => {
      const u = new URL(req.url, 'http://localhost')
      const session = u.searchParams.get('session') || ''
      const rootId = resolveRootId(session) || session
      let files = sessionFilesOf(session)
      if (!files && rootId !== session) files = sessionFilesOf(rootId)
      // ctx：每个变更块保留的上下文行数（客户端点「省略 N 行」展开时传大值）；
      // 缺省/非法时用默认折叠，钳制在 0..500 防止滥用（compactHunks 里另有超大文件防护）
      const ctxRaw = Number(u.searchParams.get('ctx'))
      const ctxLines = Number.isFinite(ctxRaw) ? Math.min(500, Math.max(0, Math.floor(ctxRaw))) : undefined
      sendJson(res, 200, buildDetail(files || new Map(), u.searchParams.get('path') || '', rootId, ctxLines))
    }
  }), 'diff-review: file route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/against',
    handler: handleAgainst
  }), 'diff-review: against route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/turn',
    handler: (req, res) => {
      const u = new URL(req.url, 'http://localhost')
      const session = u.searchParams.get('session') || ''
      let files = sessionFilesOf(session)
      if (!files) {
        const rootId = resolveRootId(session)
        if (rootId !== session) files = sessionFilesOf(rootId)
      }
      const turn = Number(u.searchParams.get('turn'))
      sendJson(res, 200, buildTurn(files || new Map(), Number.isFinite(turn) ? turn : -1, resolveRootId(session) || session))
    }
  }), 'diff-review: turn route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/clear',
    handler: (req, res) => {
      const agentId = queryParam(req, 'session')
      sessions.delete(agentId)
      persistSession(agentId, null)
      broadcast(agentId)
      sendJson(res, 200, { ok: true })
    }
  }), 'diff-review: clear route')
  // UI 偏好（面板高度等）：按会话读写 diff-review/ui/<sessionId>.json
  // GET /diff-review/ui-prefs?session=<sid>；POST body { session, panelH, collapsed }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/ui-prefs',
    handler: (req, res) => {
      try {
        if (req.method === 'POST') {
          readJsonBody(req).then((body) => {
            try {
              const session = body && typeof body.session === 'string' ? body.session : ''
              if (!session) return sendJson(res, 400, { ok: false, error: '缺少 session' })
              const patch = {}
              if (body && Number.isFinite(body.panelH)) {
                patch.panelH = Math.max(96, Math.min(4000, Math.round(body.panelH)))
              }
              // 审查列表展开/折叠（true = 展开）：只由用户点击写入，重启/刷新后照旧
              if (body && typeof body.collapsed === 'boolean') {
                patch.collapsed = body.collapsed
              }
              writeUiPrefs(session, patch)
              sendJson(res, 200, { ok: true })
            } catch (e) {
              sendJson(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          }).catch((e) => sendJson(res, 400, { ok: false, error: String((e && e.message) || e) }))
          return
        }
        const session = queryParam(req, 'session')
        sendJson(res, 200, { ok: true, prefs: session ? readUiPrefs(session) : {} })
      } catch (e) {
        sendJson(res, 200, { ok: true, prefs: {} })
      }
    }
  }), 'diff-review: ui-prefs route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/revert',
    handler: handleRevert
  }), 'diff-review: revert route')

  // ── editor detection: list installed code editors for the file-open chooser ──
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/editors',
    handler: (req, res) => {
      const editors = detectEditors()
      sendJson(res, 200, { editors })
    }
  }), 'diff-review: editors route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/open-with-editor',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const { editor, path: filePath, line, col } = body
        if (!editor || !filePath) {
          return sendJson(res, 400, { ok: false, error: '缺少 editor 或 path 参数' })
        }
        const eds = detectEditors()
        const ed = eds.find((e) => e.id === editor)
        if (!ed || !ed.detected) {
          return sendJson(res, 400, { ok: false, error: '编辑器 ' + editor + ' 未安装或未检测到' })
        }
        // Use the app-bundle executable path when the CLI is not in PATH,
        // so editors installed as .app still open via the real binary.
        let cmdBin = ed.command
        if (ed.execPaths) {
          const p = ed.execPaths.find((p) => existsSync(p))
          if (p) cmdBin = escapeShellArg(p)
        }
        let cmd = cmdBin
        if (ed.openTemplate) {
          const absPath = resolvePath(filePath)
          const quoted = escapeShellArg(absPath)
          cmd = ed.openTemplate
            .replace('{cmd}', cmdBin)
            .replace('{file}', quoted)
            .replace('{line}', line != null ? String(line) : '1')
            .replace('{col}', col != null ? String(col) : '1')
        } else {
          cmd += ' ' + escapeShellArg(filePath)
        }
        try {
          execSync(cmd, { timeout: 10000, stdio: 'ignore' })
          sendJson(res, 200, { ok: true })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: '打开编辑器失败: ' + String((e && e.message) || e) })
        }
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }
  }), 'diff-review: open-with-editor route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/reveal',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const filePath = body && body.path
        if (!filePath) return sendJson(res, 400, { ok: false, error: '缺少 path 参数' })
        const abs = resolvePath(filePath)
        const platform = process.platform
        let cmd
        if (platform === 'darwin') cmd = 'open -R ' + escapeShellArg(abs)
        else if (platform === 'win32') cmd = 'explorer.exe /select,' + escapeShellArg(abs)
        else cmd = 'xdg-open ' + escapeShellArg(dirname(abs))
        execSync(cmd, { timeout: 10000, stdio: 'ignore' })
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }
  }), 'diff-review: reveal route')
  // 用系统默认程序打开文件（审查列表点文件名）：宿主自己 spawn 打开器，
  // 不依赖浏览器端是否存在「打开文件」客户端 API。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/open',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const filePath = body && body.path
        if (!filePath) return sendJson(res, 400, { ok: false, error: '缺少 path 参数' })
        const abs = resolvePath(filePath)
        if (!existsSync(abs)) return sendJson(res, 404, { ok: false, error: '文件不存在：' + abs })
        openPathWithDefaultApp(abs)
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    }
  }), 'diff-review: open route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/diff-review/editor-icon/:id',
    handler: (req, res) => {
      try {
        const id = req.params && req.params.id
        if (!id) { res.statusCode = 400; res.end('missing id'); return; }
        const iconPath = getEditorIconPath(id)
        if (!iconPath) { res.statusCode = 404; res.end('not found'); return; }
        const iconPng = execSync('sips -s format png "' + iconPath.replace(/"/g, '\"') + '" --stdout 2>/dev/null', { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'max-age=86400')
        res.end(iconPng)
      } catch (e) {
        res.statusCode = 500
        res.end(String((e && e.message) || e))
      }
    }
  }), 'diff-review: editor-icon route')
}
/** helpers: check if a command is available or an app path exists */
function which(cmd) {
  try { execSync('which ' + cmd, { stdio: 'pipe' }); return true } catch (e) { return false }
}
function existsAny(paths) { return paths.some((p) => existsSync(p)) }

/** Detect installed code editors on this machine. */
function detectEditors() {
  const candidates = [
    // VS Code / forks
    { id: 'vscode', name: 'Visual Studio Code', command: 'code', openTemplate: '{cmd} --goto {file}:{line}:{col}', appPaths: ['/Applications/Visual Studio Code.app'], execPaths: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'], detected: which('code') || existsAny(['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']) },
    { id: 'vscode-insiders', name: 'VS Code Insiders', command: 'code-insiders', openTemplate: '{cmd} --goto {file}:{line}:{col}', appPaths: ['/Applications/Visual Studio Code - Insiders.app'], execPaths: ['/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders'], detected: which('code-insiders') || existsAny(['/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders']) },
    { id: 'vscodium', name: 'VSCodium', command: 'codium', openTemplate: '{cmd} --goto {file}:{line}:{col}', appPaths: ['/Applications/VSCodium.app'], execPaths: ['/Applications/VSCodium.app/Contents/Resources/app/bin/codium'], detected: which('codium') || existsAny(['/Applications/VSCodium.app/Contents/Resources/app/bin/codium']) },
    { id: 'cursor', name: 'Cursor', command: 'cursor', openTemplate: '{cmd} --goto {file}:{line}:{col}', appPaths: ['/Applications/Cursor.app'], execPaths: ['/Applications/Cursor.app/Contents/MacOS/Cursor'], detected: which('cursor') || existsAny(['/Applications/Cursor.app/Contents/MacOS/Cursor']) },
    { id: 'windsurf', name: 'Windsurf', command: 'windsurf', openTemplate: '{cmd} {file}', appPaths: ['/Applications/Windsurf.app'], execPaths: ['/Applications/Windsurf.app/Contents/MacOS/windsurf'], detected: which('windsurf') || existsAny(['/Applications/Windsurf.app/Contents/MacOS/windsurf']) },
    { id: 'zed', name: 'Zed', command: 'zed', openTemplate: '{cmd} {file}:{line}:{col}', appPaths: ['/Applications/Zed.app'], execPaths: ['/Applications/Zed.app/Contents/MacOS/zed'], detected: which('zed') || existsAny(['/Applications/Zed.app/Contents/MacOS/zed']) },
    // JetBrains
    { id: 'idea', name: 'IntelliJ IDEA Ultimate', command: 'idea', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/IntelliJ IDEA.app'], execPaths: ['/Applications/IntelliJ IDEA.app/Contents/MacOS/idea'], detected: which('idea') || existsAny(['/Applications/IntelliJ IDEA.app/Contents/MacOS/idea']) },
    { id: 'idea-community', name: 'IntelliJ IDEA Community', command: 'idea', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/IntelliJ IDEA CE.app'], execPaths: ['/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea'], detected: existsAny(['/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea']) },
    { id: 'pycharm', name: 'PyCharm Professional', command: 'pycharm', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/PyCharm.app'], execPaths: ['/Applications/PyCharm.app/Contents/MacOS/pycharm'], detected: which('pycharm') || existsAny(['/Applications/PyCharm.app/Contents/MacOS/pycharm']) },
    { id: 'pycharm-ce', name: 'PyCharm Community', command: 'pycharm', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/PyCharm CE.app'], execPaths: ['/Applications/PyCharm CE.app/Contents/MacOS/pycharm'], detected: existsAny(['/Applications/PyCharm CE.app/Contents/MacOS/pycharm']) },
    { id: 'webstorm', name: 'WebStorm', command: 'webstorm', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/WebStorm.app'], execPaths: ['/Applications/WebStorm.app/Contents/MacOS/webstorm'], detected: which('webstorm') || existsAny(['/Applications/WebStorm.app/Contents/MacOS/webstorm']) },
    { id: 'goland', name: 'GoLand', command: 'goland', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/GoLand.app'], execPaths: ['/Applications/GoLand.app/Contents/MacOS/goland'], detected: which('goland') || existsAny(['/Applications/GoLand.app/Contents/MacOS/goland']) },
    { id: 'datagrip', name: 'DataGrip', command: 'datagrip', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/DataGrip.app'], execPaths: ['/Applications/DataGrip.app/Contents/MacOS/datagrip'], detected: which('datagrip') || existsAny(['/Applications/DataGrip.app/Contents/MacOS/datagrip']) },
    { id: 'phpstorm', name: 'PhpStorm', command: 'phpstorm', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/PhpStorm.app'], execPaths: ['/Applications/PhpStorm.app/Contents/MacOS/phpstorm'], detected: which('phpstorm') || existsAny(['/Applications/PhpStorm.app/Contents/MacOS/phpstorm']) },
    { id: 'rubymine', name: 'RubyMine', command: 'rubymine', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/RubyMine.app'], execPaths: ['/Applications/RubyMine.app/Contents/MacOS/rubymine'], detected: which('rubymine') || existsAny(['/Applications/RubyMine.app/Contents/MacOS/rubymine']) },
    { id: 'clion', name: 'CLion', command: 'clion', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/CLion.app'], execPaths: ['/Applications/CLion.app/Contents/MacOS/clion'], detected: which('clion') || existsAny(['/Applications/CLion.app/Contents/MacOS/clion']) },
    { id: 'rustrover', name: 'RustRover', command: 'rustrover', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/RustRover.app'], execPaths: ['/Applications/RustRover.app/Contents/MacOS/rustrover'], detected: which('rustrover') || existsAny(['/Applications/RustRover.app/Contents/MacOS/rustrover']) },
    // Android Studio
    { id: 'android-studio', name: 'Android Studio', command: 'studio', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/Android Studio.app'], execPaths: ['/Applications/Android Studio.app/Contents/MacOS/studio'], detected: which('studio') || existsAny(['/Applications/Android Studio.app/Contents/MacOS/studio']) },
    { id: 'fleet', name: 'Fleet', command: 'fleet', openTemplate: '{cmd} {file}', appPaths: ['/Applications/Fleet.app'], execPaths: ['/Applications/Fleet.app/Contents/MacOS/fleet'], detected: which('fleet') || existsAny(['/Applications/Fleet.app/Contents/MacOS/fleet']) },
    // Apple
    { id: 'xcode', name: 'Xcode', command: 'xed', openTemplate: '{cmd} --line {line} {file}', appPaths: ['/Applications/Xcode.app'], execPaths: ['/Applications/Xcode.app/Contents/Developer/usr/bin/xed'], detected: which('xed') || existsAny(['/Applications/Xcode.app/Contents/Developer/usr/bin/xed']) },
    // Other macOS editors
    { id: 'sublime', name: 'Sublime Text', command: 'subl', openTemplate: '{cmd} {file}:{line}:{col}', appPaths: ['/Applications/Sublime Text.app'], execPaths: ['/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'], detected: which('subl') || existsAny(['/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl']) },
    { id: 'bbedit', name: 'BBEdit', command: 'bbedit', openTemplate: '{cmd} {file}', appPaths: ['/Applications/BBEdit.app'], execPaths: ['/Applications/BBEdit.app/Contents/Helpers/bbedit_tool'], detected: which('bbedit') || existsAny(['/Applications/BBEdit.app/Contents/Helpers/bbedit_tool']) },
    { id: 'mate', name: 'TextMate', command: 'mate', openTemplate: '{cmd} {file}', appPaths: ['/Applications/TextMate.app'], execPaths: ['/Applications/TextMate.app/Contents/Resources/mate'], detected: which('mate') || existsAny(['/Applications/TextMate.app/Contents/Resources/mate']) },
    { id: 'nova', name: 'Nova', command: 'nova', openTemplate: '{cmd} {file}:{line}:{col}', appPaths: ['/Applications/Nova.app'], execPaths: ['/Applications/Nova.app/Contents/MacOS/nova'], detected: which('nova') || existsAny(['/Applications/Nova.app/Contents/MacOS/nova']) },
    { id: 'coteditor', name: 'CotEditor', command: 'cot', openTemplate: '{cmd} {file}', appPaths: ['/Applications/CotEditor.app'], execPaths: ['/Applications/CotEditor.app/Contents/MacOS/cot'], detected: which('cot') || existsAny(['/Applications/CotEditor.app/Contents/MacOS/cot']) },
    // Terminal editors
    { id: 'vim', name: 'Vim', command: 'vim', openTemplate: '{cmd} {file}', appPaths: [], execPaths: [], detected: which('vim') },
    { id: 'nvim', name: 'Neovim', command: 'nvim', openTemplate: '{cmd} {file}', appPaths: [], execPaths: [], detected: which('nvim') },
    { id: 'emacs', name: 'Emacs', command: 'emacs', openTemplate: '{cmd} {file}', appPaths: ['/Applications/Emacs.app'], execPaths: ['/Applications/Emacs.app/Contents/MacOS/emacs'], detected: which('emacs') || existsAny(['/Applications/Emacs.app/Contents/MacOS/emacs']) },
    { id: 'nano', name: 'nano', command: 'nano', openTemplate: '{cmd} {file}', appPaths: [], execPaths: [], detected: which('nano') },
    // macOS fallback
    { id: 'textedit', name: 'TextEdit', command: 'open', openTemplate: '{cmd} -a TextEdit {file}', appPaths: ['/System/Applications/TextEdit.app'], execPaths: [], detected: process.platform === 'darwin' },
  ]
  return candidates
}/** Find the first existing .icns icon file for an editor app bundle. */
function getEditorIconPath(editorId) {
  const eds = detectEditors()
  const ed = eds.find((e) => e.id === editorId)
  if (!ed || !ed.detected || !ed.appPaths || ed.appPaths.length === 0) return null
  for (const appPath of ed.appPaths) {
    if (!existsSync(appPath)) continue
    const resources = appPath + '/Contents/Resources'
    if (!existsSync(resources)) continue
    // Try Info.plist first
    const plist = appPath + '/Contents/Info.plist'
    try {
      const plistText = readFileSync(plist, 'utf8')
      const iconMatch = plistText.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)
      if (iconMatch) {
        const iconName = iconMatch[1].replace(/\.icns$/i, '')
        const iconPath = resources + '/' + iconName + '.icns'
        if (existsSync(iconPath)) return iconPath
      }
    } catch (e) {}
    // Fallback: scan for .icns files
    try {
      const files = readdirSync(resources)
      const icns = files.find((f) => f.endsWith('.icns'))
      if (icns) return resources + '/' + icns
    } catch (e) {}
  }
  return null
}

function escapeShellArg(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

// ── 系统默认程序打开文件 ──────────────────────────────────────────────
// spawn 走参数数组而不是拼 shell 字符串。Windows 特殊：start 是 cmd 内建命令，
// 必须经 cmd /c；且 cmd 的解析规则与 Node 默认加引号规则不同——含 & ^ 等元字符
// 但不含空格的路径 Node 不会加引号，会被 cmd 当命令分隔符，故 Windows 分支改用
// windowsVerbatimArguments 自行加引号，并把第一个空串作为窗口标题占位（否则首个
// 带引号的路径会被 start 当成标题）。子进程 detached + unref 不阻塞宿主；必须挂
// error 监听，否则 spawn 失败（如 Linux 无 xdg-open）会变成未捕获异常。
function openPathWithDefaultApp(absPath) {
  const platform = process.platform
  let cmd = ''
  let args = []
  let verbatim = false
  if (platform === 'win32') {
    cmd = 'cmd.exe'
    args = ['/c', 'start', '""', '"' + absPath + '"']
    verbatim = true
  } else if (platform === 'darwin') {
    cmd = 'open'
    args = [absPath]
  } else {
    cmd = 'xdg-open'
    args = [absPath]
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim })
  child.on('error', (e) => { console.error('diff-review open failed', e) })
  child.unref()
  return cmd
}

export { apply, buildSnapshotHunks, cap, diffHunks, diffLines, diffLinesChunked, inject, loadSessionFile, merge3, migrateLegacyState, name, persistSession, serializeSessionFiles, splitLines }
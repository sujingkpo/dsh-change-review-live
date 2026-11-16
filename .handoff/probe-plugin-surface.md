# 本插件「工具名 / 入参字段」依赖面清点 — 只读探针

> @description lib/index.js 与 lib/client.js 中所有依赖具体工具名或入参字段名的代码位置，逐条给行号、签名、关键代码行，并给出接入 ops_write_file / ops_edit_file / ops_bash / ops_inspect_local_file 的改动面判定
> @author plugin-probe
> @date 2026-11-06
> 取值口径：本机安装件 `C:\Users\czy\.dsh\profiles\desktop\node_modules\dsh-ops`（0.5.0）+ DSH 0.2.2-rc.1 的 tools 执行模型；行号对应当前工作区 HEAD 的 `lib/index.js`（2042 行）与 `lib/client.js`（3045 行）。

## 0. 结论速览

| 类别 | 位置 | 只靠映射表够吗 |
| --- | --- | --- |
| 工具名白名单（排序/分类） | index.js:159 TOOL_LABELS、index.js:253 SHELL_TOOLS、client.js:1290 SHELL_TOOL_LABELS、client.js:1632 LIVE_SOURCE_EDIT | **够**，加名字即可 |
| 入参字段取值 | index.js:1249-1251、1297、1299、67、70 | **不够**，必须改逻辑（`path` 而非 `file_path`；`edits[]` 拼装） |
| 结果载荷 before/after | index.js:1282-1290 | **不够，且是硬伤**：dsh-ops 的写工具**不回传文件内容**（只有 revision/bytes/lineCount），快照与撤回链路必须换源 |
| 快照差机制 | index.js:1210-1230 / 1147-1207 / 534 | 判据本身与工具名无关，**复用即可**；只需补 cwd 来源与一个「精确路径」入口 |
| 渲染侧语言/文案 | client.js:765-771 langOf、1063 kindLabel、1696-1697 chips | langOf 与 chips **不按工具名**，不必改；kindLabel 与 tooltip 文案要跟 |

一句话：**能只靠映射表的只有 4 处名字表；真正的改动集中在 `tools/result` 的 write/edit 分支（字段名 + before/after 缺失回退）与 `isNoopWriteEdit`（edits[] 判据）两处逻辑。**

---

## 1. TOOL_LABELS（index.js:159）与 SHELL_TOOLS（index.js:253）

### 1.1 TOOL_LABELS

```js
// lib/index.js:158-159
// 工具标签顺序（固定，UI 显示稳定）：内置工具在前，shell 类在后
const TOOL_LABELS = ['write', 'edit', 'pwsh', 'bash', 'run_code']
```

- **值**：5 个工具名的**有序数组**（不是 map，没有展示文案，也没有中文名）。
- **唯一消费点**：`toolsOf(ops)`（index.js:163-175），用下标当排序权重：

```js
// lib/index.js:161-175
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
```

- **注意**：`via` 优先、否则按 `op.kind` 退回 `'edit'`/`'write'`——所以**内置 write/edit 不写 via**（见 index.js:1197 注释与 1297/1299 的 push），只有 shell 快照补的 op 才带 via。
- **用在哪个 UI 标签上**：`toolsOf` 的结果进 `tools` 字段 → `buildSummary`（index.js:1375）与 `buildTurn`（index.js:1622）的 `tools: toolsOf(...)` → 客户端 `f.tools` → 列表行里那一排小徽标 `span.dsdrv-livepanel-tool`（client.js:2290-2297）。**数组只决定徽标的先后顺序**，文案就是工具名本身（没有中文映射）。

### 1.2 SHELL_TOOLS

```js
// lib/index.js:244-257
const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])
const SNAP_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', ...])
const SNAP_MAX_FILES = 4000
const SNAP_MAX_CHANGES = 50
const SNAP_BASELINE_TTL = 5 * 60 * 1000
```

- **值**：Set，判定「该工具没有文件清单、要用命令前后快照做差」。
- **两个消费点**：
  1. `tools/pre-execute` → 建基线（index.js:1213）；
  2. `tools/result` → 取基线做差（index.js:1237）。
- **UI 上的对应**：客户端那排徽标的**暖色底** `dsdrv-livepanel-tool-shell`（CSS client.js:2810 `background:rgba(255,169,77,0.2)`）+ tooltip「由 X 脚本修改（内容取自命令前后两次磁盘快照）」，判定用的是客户端自己的 `SHELL_TOOL_LABELS`（见第 5 节），**不是**这个 Set。

---

## 2. `ctx.on('tools/result')` 的分支逻辑（index.js:1232-1306）

### 2.1 整体骨架

```js
// lib/index.js:1232-1248
ctx.on('tools/result', (exec, result) => {
  try {
    if (!exec) return
    const toolName = exec.tool || exec.name          // 1245
    if (SHELL_TOOLS.has(toolName)) { ... return }    // 1237-1247
    if (toolName !== 'write' && toolName !== 'edit') return   // 1248
```

- **分支一（shell）**：从 `shellBaselines` 取 callId 对应基线 → 删除 → `setImmediate(() => recordShellChanges(shellAgentId, base.cwd, base.snap, toolName))`（1237-1247）。
- **分支二（write/edit）**：1248 起。

> 注：`exec.tool` 在当前 DSH 执行模型里不存在（execution 对象只有 `name`），所以实际永远命中 `exec.name`（`dsh-tools/lib/index.js:3239-3254` 的 base 只 spread `callId/rootCallId/name/signal/agent/parent/schema`）。同理 `exec.input` 也不存在，靠的是 3263 行的 `arguments`。

### 2.2 判断 write / edit 与取字段

```js
// lib/index.js:1248-1252
      if (toolName !== 'write' && toolName !== 'edit') return          // ① 工具名硬比较
      const input = exec.input || exec.arguments || exec.args          // ② 入参对象
      if (!input || typeof input !== 'object') return
      const file = input.file_path || input.file || input.path         // ③ 路径字段三选一
      if (!file) return
```

```js
// lib/index.js:1280-1290
      const value = result && !result.isError && result.value && typeof result.value === 'object' ? result.value : null
      const hasBefore = value !== null && 'before' in value
      const hasAfter = value !== null && 'after' in value
      const before = hasBefore ? snapOf(value.before) : undefined
      const after = hasAfter ? snapOf(value.after) : undefined
      if (isNoopWriteEdit(toolName, input, before, after, prevAfterOf(rec))) { return }
```

```js
// lib/index.js:1295-1300
      if (rec.ops.length >= MAX_OPS) rec.ops.shift()
      if (toolName === 'edit') {
        rec.ops.push({ kind: 'edit', at, turn, before, after, oldString: cap(input.old_string), newString: cap(input.new_string) })
      } else {
        rec.ops.push({ kind: 'write', at, turn, before, after, content: cap(input.content) })
      }
```

- **入参字段依赖（write/edit 分支的全部）**：`file_path|file|path`（1251）、`old_string`/`new_string`（1297）、`content`（1299）。
- **结果载荷依赖**：`result.isError`、`result.value.before`、`result.value.after`（1282-1286）；失败判定 1255：`result.isError || result.error || result.ok === false || result.failed`。
- **cwd 唯一来源**：`exec.agent.session.header.cwd`（1263）——**完全不看 input 里的路径/工作目录字段**。

### 2.3 pwsh / bash / run_code 走哪条分支、怎么取 cwd 与 command

- 三者都命中 1237 的 `SHELL_TOOLS`，**不看 command**——命令内容从不解析（AGENTS.md 里的「删除不补 op」就是这个原因）。
- cwd 取自**执行前快照时记下的** `exec.agent.session.header.cwd`（index.js:1222），随基线一起存 `shellBaselines.set(callId, {cwd, snap, at})`（1223），result 阶段直接用 `base.cwd`（1244）。**input.command / workdir 一律不读**。
- `run_code` 的 cwd 特例：宿主在该工具上另有 workdir 语义，但插件拿不到，所以脚本在别的目录落盘只能靠「本会话已记录过的文件」逐个 stat 兜住（`knownPathsOf`，1115-1124）。

---

## 3. `ctx.on('tools/pre-execute')`：基线快照怎么建立、callId 怎么关联

```js
// lib/index.js:1209-1230
  // 命令执行前取基线；waterfall 语义：无论快照成败都必须放行工具
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = exec && (exec.name || exec.tool)                  // 1212
      if (SHELL_TOOLS.has(toolName)) {
        const now = Date.now()
        for (const [id, item] of shellBaselines) {                        // 1216-1218 过期清理
          if (now - item.at > SNAP_BASELINE_TTL) shellBaselines.delete(id)
        }
        const callId = exec.callId || exec.rootCallId                     // 1219
        const agentId = exec.agent && exec.agent.id                       // 1220
        if (callId && agentId) {
          const cwd = exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
          shellBaselines.set(callId, { cwd, snap: snapshotOf(cwd, knownPathsOf(resolveRootId(agentId))), at: now })   // 1223
        }
      }
    } catch (e) { /* 快照失败不能影响工具执行 */ }
    return next()
  })
```

- **键**：`shellBaselines: Map<callId, {cwd, snap, at}>`（index.js:1109）；result 侧用同一套 `exec.callId || exec.rootCallId`（1238）取回，取完即 `delete`（1241），避免重复消费。
- **快照内容**：`snapshotOf(cwd, knownPaths)` → `Map<absPath, 'size:mtimeMs'>`（index.js:309-332）；来源三层：git status（270-289）→ 目录遍历（292-306）→ 已知路径逐个 stat（326-330）。
- **TTL**：5 分钟（index.js:257），只在这里顺手清（工具被拦下不会有 result）。
- **PTC 嵌套也成立**：`run_code` 内的内层工具调用由 `dsh-tools` 用 `subCallId = \`${exec.callId}:ptc:${n}\`` 走同一套 pre-execute/result（`dsh-tools/lib/index.js:1367-1377`、1431、3491），所以 callId 配对天然成立；只有 `run_code` 外层调用也在 SHELL_TOOLS 里，会多取一次基线，重复记录靠 index.js:1189 的「与上一份内容相同就跳过」消掉。

---

## 4. 三个关键函数的签名与判据

### 4.1 `isNoopWriteEdit(toolName, input, before, after, prevAfter)` — index.js:59-72

```js
function isNoopWriteEdit(toolName, input, before, after, prevAfter) {
  const b = normalizeEol(before)
  const a = normalizeEol(after)
  const p = normalizeEol(prevAfter)
  if (typeof b === 'string' && typeof a === 'string' && b === a) { return true }        // ① 64
  if (typeof a === 'string' && typeof p === 'string' && a === p) { return true }        // ② 65
  const src = input || {}
  if (toolName === 'edit' && typeof src.old_string === 'string' && src.old_string === src.new_string) { return true }   // ③ 67
  if (toolName === 'write' && typeof src.content === 'string' && src.content.length < FRAG_MAX_CHARS && normalizeEol(src.content) === p) { return true }  // ④ 70
  return false
}
```

- **判据依赖**：① ② 只吃 before/after/prevAfter（**与工具名无关**）；③ ④ 吃**工具名 + 具体字段名**（`old_string`/`new_string`/`content`）。
- ④ 的 `< FRAG_MAX_CHARS`（350000，index.js:26）是防「截断后相等」误杀；`cap()`（101-104）在写 op 时也按同一上限截断。
- 调用点唯一：index.js:1290，**必须在建记录之前**（注释 1287-1289 讲了这条教训）。

### 4.2 `recordShellChanges(agentId, cwd, before, via)` — index.js:1147-1207

```js
  function recordShellChanges(agentId, cwd, before, via) {
    try {
      const rootId = resolveRootId(agentId)
      const files = filesOf(rootId)
      const known = []                                                   // 1153-1156 已记录文件
      for (const rec of files.values()) { ... known.push(absPathOf(rec.cwd, rec.path)) }
      const after = snapshotOf(cwd, known)                               // 1157
      const changed = diffSnapshot(before, after)                        // 1158
      if (changed.length === 0) return
      ...
      for (const abs of changed) {
        let content = ''
        try {
          if (statSync(abs).size > SNAPSHOT_MAX_CHARS) continue          // 1166
          content = readFileSync(abs, 'utf8')                            // 1167
        } catch (e) { continue }                                          // 删除不补 op
        ...
        const prev = rec && rec.ops.length > 0 ? rec.ops[rec.ops.length - 1].after : undefined   // 1187
        if (prev !== undefined && normalizeEol(prev) === normalizeEol(value)) continue           // 1189 去重
        if (!rec) { rec = { path: abs, cwd, ops: [] }; files.set(abs, rec) }                     // 1190-1193
        const head = prev === undefined ? headContentOf(cwd, abs) : undefined                    // 1194
        const beforeValue = prev !== undefined ? prev : (head === undefined ? null : snapOf(head)) // 1195
        if (rec.ops.length >= MAX_OPS) rec.ops.shift()
        rec.ops.push({ kind: 'write', at, turn, before: beforeValue, after: value, content: cap(content), via: via || 'shell' })  // 1197
        recorded++
      }
      if (recorded > 0) { broadcast(rootId); markDirty(rootId) }         // 1200-1203
    } catch (e) { console.error('diff-review shell track failed', e) }
  }
```

- **关键判据行**：1189（内容去重）、1166-1167（大小/读取失败即跳过）、1194-1195（before 来源三级：上一份 after → git HEAD → null 视为新增）。
- **与工具名无关**：整个函数只把 `via` 透传进 op，其余判据按文件/内容。**复用成本低**。
- before 兜底 `headContentOf`（1127-1141）：`git show HEAD:<rel>`，失败返回 `undefined` → 记为 `null`（新增）。**副作用**：仓库里已提交文件在命令前后都没记录时，before 取 HEAD 而非真实盘上内容；命令若只改未提交内容，diff 会包含此前未提交的改动。

### 4.3 `buildSnapshotHunks(before, after, ctxLines, clusterExpands)` — index.js:534-590

```js
function buildSnapshotHunks(before, after, ctxLines, clusterExpands) {
  if (looksBinaryText(before) || looksBinaryText(after)) { ... }   // 536-538 二进制守卫
  before = normalizeEol(before); after = normalizeEol(after)        // 540-541
  const oldL = splitLines(normLf(before === null ? '' : before))    // 544
  const newL = splitLines(normLf(after))                            // 545
  // 546-552 公共前缀/后缀剥离
  const limit = bothSides ? MAX_DIFF_LINES : MAX_WHOLE_LINES        // 560
  if (mo.length > MAX_WHOLE_LINES || mn.length > MAX_WHOLE_LINES) { truncated = true; ... }  // 562-566
  ... overLimit ? diffLinesChunked(mo, mn) : diffLines(mo, mn)      // 578
  return { hunks: compactHunks(rows, ctxLines, clusterExpands), truncated }   // 589
}
```

- **纯内容函数，零工具名依赖**。调用点：1419、1451、1580（against）、以及导出的单测入口（2043 的 export 列表）。
- `before === null` 表示会话内新建（全部算新增，544 行）。
- 判据常量：`MAX_DIFF_LINES = 3000`、`DIFF_CHUNK_LINES = 1000`、`MAX_WHOLE_LINES = 20000`（index.js:30-35）。

---

## 5. 客户端 lib/client.js 的映射点

| 位置 | 代码 | 是不是「工具名→展示文案」映射 |
| --- | --- | --- |
| **client.js:1290** | `const SHELL_TOOL_LABELS = ["pwsh", "bash", "run_code"];` | **是（分类器，不是文案表）**。唯一用途是给徽标加暖色 class 与「脚本修改」tooltip，见 2293-2296。 |
| **client.js:1632** | `const LIVE_SOURCE_EDIT = ["write", "edit"];` | **是**。`liveSourceOf(tool)`（1636-1638）→ `'edit'`/`'command'`，供来源 chip（1681）与关键词别名（1650）。 |
| **client.js:1696** | `const LIVE_STATUS_CHIPS = [["added","新增"],["modified","修改"]];` | **不是**。取值是 `f.status`，与工具名无关。 |
| **client.js:1697** | `const LIVE_SOURCE_CHIPS = [["edit","编辑"],["command","命令"]];` | **半是**：chip 取值是来源分组（由 LIVE_SOURCE_EDIT 派生），标签固定；只有 2234-2236 的 **tooltip 里硬写了工具名**。 |
| **client.js:765-771** | `HL_EXT` + `function langOf(path)` | **不是**。按文件扩展名 → 语言，与工具名无关。调用点 1183 / 1595 / 2456 传的都是文件路径。 |

补两条容易被忽略的渲染侧工具名痕迹：

- **client.js:1063**：`const kindLabel = section.kind === "edit" ? "编辑" : "写入";` —— 按 **op.kind**（Host 写死的 `'edit'`/`'write'`），不按工具名。**Host 若把 ops_edit_file 记成 kind:'write'，面板徽标就会错写成「写入」。**
- **client.js:2234-2236**（来源 chip 的 tooltip）：
  ```js
  c[0] === "edit" ? "只看内置 write / edit 工具改过的文件（可多选，再点取消）"
                  : "只看命令跑出来的改动：pwsh / bash / run_code 快照（含未知来源，可多选，再点取消）"
  ```
- **client.js:2288-2297**（徽标文案）：
  ```js
  className: "dsdrv-livepanel-tool" + (SHELL_TOOL_LABELS.indexOf(tool) >= 0 ? " dsdrv-livepanel-tool-shell" : ""),
  title: SHELL_TOOL_LABELS.indexOf(tool) >= 0
    ? "由 " + tool + " 脚本修改（内容取自命令前后两次磁盘快照）"
    : "由内置 " + tool + " 工具修改"
  ```

---

## 6. 接入 ops_* 的逐处改动判定

### 6.0 目标工具的入参与回传（据安装件源码）

| 工具 | 入参（安装件 `dsh-ops/lib/capabilities/file.js`） | 回传内容 |
| --- | --- | --- |
| `ops_write_file` | `{path, content, expectedRevision, dryRun}`（file.js:54） | `{revision, bytes, lineCount, status, dryRun, ...}`（OUTPUT，file.js:68-81）——**无 before/after，无 content** |
| `ops_edit_file` | `{path, expectedRevision, edits:[{oldText,newText}], dryRun}`（file.js:15） | 同上，**无 before/after** |
| `ops_bash` | `{command, description, script_path, workdir, timeoutMs, graceMs, includeDiagnostics, run_in_background}`（`lib/shells/constants.js:44`） | 宿主 shell 结果，**无文件清单** |
| `ops_inspect_local_file` | `{path, offset, limit, encoding, view}`（file.js:21-27） | 只读行文本；**本插件当前不会记录它，也无需记录** |

工具名一律是 `ops_` + rawName（`dsh-ops/lib/policy.js:18-20`：`TOOL_PREFIX = 'ops_'`）。

### 6.1 逐处判定表

| # | 位置 | 现状 | 接入 ops_* 需要什么 | 只靠映射表？ | 必须改逻辑？ |
| --- | --- | --- | --- | --- | --- |
| 1 | index.js:159 `TOOL_LABELS` | 5 个名字的排序表 | 追加 `ops_write_file` / `ops_edit_file` / `ops_bash`（决定徽标先后） | ✅ 是 | 否 |
| 2 | index.js:253 `SHELL_TOOLS` | `pwsh/bash/run_code` | 加 `ops_bash` | ✅ 是 | 否 |
| 3 | index.js:1248 工具名硬比较 | `toolName !== 'write' && toolName !== 'edit'` | 扩成「按工具名查一张 spec 表」：`{kind:'write'|'edit', pathField, contentField, isNoop}` | ❌ 否 | **是** |
| 4 | index.js:1251 路径字段 | `input.file_path \|\| input.file \|\| input.path` | ops_* 只有 `path`（现有兜底恰好命中，**但语义覆盖不到 `file_path` 之外的自定义字段**，建议显式化） | ⚠️ 恰好可用 | 建议改 |
| 5 | index.js:1297 edit 分支 | `input.old_string` / `input.new_string` | ops_edit_file 是 `edits:[{oldText,newText}]`，要拼：`oldString = edits.map(e=>e.oldText).join('\\n')`、`newString = ...newText...` | ❌ 否 | **是** |
| 6 | index.js:1299 write 分支 | `input.content` | ops_write_file 有 `content`，**可直接用** | ✅ 是 | 否 |
| 7 | index.js:1282-1286 before/after | `result.value.before` / `.after` | ops_* **不回传内容** → 必须换源：`before` 用 pre-execute 记下的该路径内容（或 `prevAfterOf(rec)` / `headContentOf`），`after` 用执行后 `readFileSync(abs)` | ❌ 否 | **是（硬伤）** |
| 8 | index.js:1290 + 59-72 `isNoopWriteEdit` | ③ 看 `old_string===new_string`；④ 看 `content===prevAfter` | ③ 改为「每条 edit 的 `oldText===newText` 全部成立」；④ 对 write_file 仍可用（有 content）。**且 before/after 缺失时 ①②会静默失效 → 空操作重新入记录** | ❌ 否 | **是** |
| 9 | index.js:1210-1230 pre-execute | 只对 SHELL_TOOLS 建快照 | ① 加 `ops_bash`（映射即可）；② **若要给 ops_write_file/edit_file 提供 before，需要新增一条「单文件内容基线」**（键仍用 callId），这是新逻辑 | 部分 | **是（新增单文件基线）** |
| 10 | index.js:1222 / 1263 cwd 来源 | 只取 `session.header.cwd` | `ops_bash` 的 `workdir` 是**入参**：命令在别的目录落盘时，git status/遍历都在会话 cwd 下做 → 抓不到（只能靠 knownPaths 兜）。需按 `input.workdir` 解析实际目录（相对路径以会话 cwd 为基准，见 `dsh-ops/lib/session-shells.js:57-100`） | ❌ 否 | **是** |
| 11 | index.js:1147 `recordShellChanges` | 与工具名无关 | 复用即可；`via` 会自动记成 `ops_bash` | ✅ 是 | 否 |
| 12 | index.js:534 `buildSnapshotHunks` | 纯内容函数 | 不动 | ✅ 是 | 否 |
| 13 | index.js:1331-1337 / 1492-1499 统计 | 按 `op.kind` 取 `newString/oldString/content` 行数 | ops_edit_file 必须**填好 oldString/newString**，否则每个文件「+N/−M」恒为 0（content 未定义时 `splitLines(undefined)` 会抛，已被外层 try 吞掉） | ❌ 否 | 依赖 #5 |
| 14 | index.js:1406-1469 `buildSections` | `op.kind==='edit'` 走 oldString/newString 兜底；op.before/after 缺失时回退片段 | ops_* 若拿不到快照，会退化成「片段 diff」（可接受但行号不是真实行号） | ❌ 否 | 依赖 #7 |
| 15 | client.js:1290 `SHELL_TOOL_LABELS` | `["pwsh","bash","run_code"]` | 加 `"ops_bash"`（否则 ops_bash 的徽标是中性色 + 「由内置 ops_bash 工具修改」） | ✅ 是 | 否 |
| 16 | client.js:1632 `LIVE_SOURCE_EDIT` | `["write","edit"]` | 加 `"ops_write_file"`、`"ops_edit_file"`（可选 `ops_replace`）；否则它们被归到「命令」chip 下 | ✅ 是 | 否 |
| 17 | client.js:1696 `LIVE_STATUS_CHIPS` | `[["added"],["modified"]]` | **不用改**（取值是 status） | — | 否 |
| 18 | client.js:1697 `LIVE_SOURCE_CHIPS` | `[["edit","编辑"],["command","命令"]]` | 取值不用改；**标签若要区分「ops 写工具 vs 内置写工具」才需要动** | ⚠️ 视需求 | 视需求 |
| 19 | client.js:2234-2236 tooltip | 硬写 `write / edit`、`pwsh / bash / run_code` | 文案补 `ops_write_file / ops_edit_file / ops_bash` | ✅ 是（文案） | 否 |
| 20 | client.js:2288-2297 徽标 title | 「由内置 X 工具修改」 | ops_* 不是内置工具，文案会失真；建议按「ops 写工具」三分 | ⚠️ 文案 | 建议改 |
| 21 | client.js:1063 `kindLabel` | 按 `section.kind` 出「编辑/写入」 | 只要 Host 把 ops_edit_file 记成 `kind:'edit'` 就自动正确 | ✅ 是（Host 侧） | 否 |
| 22 | client.js:765-771 `HL_EXT`/`langOf` | 扩展名→语言 | **不用改**（传的是文件路径） | — | 否 |
| 23 | client.js:1864-1868 `turnSigOf` / 568-572 `summarySigOf` | 签名里含 `f.tools` | 不用改（已含 tools），但若新增展示字段要同步 | ✅ 是 | 否 |

### 6.2 两种实现路线

- **路线 A（只扩名字表 + 字段提取器）**：改动 #1/#2/#3/#4/#5/#6 + client #15/#16/#19。
  够用的前提是**接受 ops_* 的 op 没有 before/after** → 后果：① 该文件 `revertible=false`（index.js:1369、1471、1519），**撤回按钮消失**；② `buildSections` 永远走片段分支（1406 起），gutter 行号是片段相对行号；③ `isNoopWriteEdit` ①②失效 → 空操作会重新进记录（正是 2026-09-20 第十一轮修掉的那个用户痛点）。**不推荐**。
- **路线 B（复用快照机制，推荐）**：
  1. pre-execute 增加一个「单文件内容基线」：`SINGLE_FILE_TOOLS = new Map([['ops_write_file','path'], ['ops_edit_file','path']])`，命中就把 `readFileSync(absPath)` 存进 `fileBaselines.set(callId, {absPath, before})`（读不到记 `null` 表示新建）；
  2. result 侧对这两者：`after = readFileSync(absPath)`，`before = 基线`；随后**直接复用现有 write/edit 分支的去重与入记录**（`isNoopWriteEdit` + `ops.push`），只是 `oldString/newString` 对 edit_file 由 `edits[]` 拼装；
  3. `ops_bash` 走现有 SHELL_TOOLS 路径，仅需补 `workdir` → 实际 cwd 的解析，并把它加进 `SHELL_TOOLS`。
  这样 #7 的硬伤与 #8 的空操作回退一起解决，且 `buildSnapshotHunks`/`recordShellChanges` 一行都不用改。

### 6.3 未验证项（明确标注）

- `ops_write_file` / `ops_edit_file` 在本机当前会话**实测被拒**（`PUBLICATION_DENIED`，见 `.handoff/dsh-ops集成与版本核查-交接.md` 第四节），因此 `result.value` 的真实外层形状（是否再包一层 `{status, data}`）**未经实测**；本节按安装件 `OUTPUT` schema 与同批只读工具的实测返回（`{status:'completed', data:{...}}`）推断为「data 内不含 before/after」。
- `ops_replace` / `ops_copy` / `ops_move` / `ops_remove` 未在本任务范围内逐条设计；其中 `remove` 天然对应「删除不补 op」（现有 `statusOf` 已按磁盘实时判定），`copy/move` 需要双路径，建议同样走快照差而不是加白名单。

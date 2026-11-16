# 实施契约：C 路线 + 历史数据清理（v0.4.0）

> @description 两名实施者的唯一契约来源：Host 侧（lib/index.js）与客户端侧（lib/client.js）各改各的，接口以本文件为准
> @author lead
> @date 2026-11-06

## 0. 铁律（违反即返工）

- **lib/index.js 换行符必须是 CRLF、2 空格缩进；lib/client.js 必须是 CRLF、Tab 缩进**。改完各自数一遍：```bash
node -e "const s=require('fs').readFileSync('lib/index.js','utf8');const crlf=(s.match(/\r\n/g)||[]).length;const lf=(s.match(/(?<!\r)\n/g)||[]).length;console.log('CRLF',crlf,'bareLF',lf)"
``` 要求 bareLF = 0。
- 文件头不加 `@modify`；新增函数写中文注释；单行 if 也要大括号。
- **不要碰对方负责的文件**。
- 改完必须跑 `node --check lib/index.js`（或 client.js）。
- 不要提交、不要打 tag、不要改版本号（版本号由 lead 统一改）。

## 1. Host 侧（lib/index.js，负责人 host-impl）

### 1.1 工具 spec 表，认领 dsh-ops 的写工具

在 `const SHELL_TOOLS` 附近新增：

```js
// 会产生「文件内容级改动」的工具：内置 write/edit 与 dsh-ops 的 ops_write_file/ops_edit_file。
// 两者的差别只在入参：内置用 file_path + old_string/new_string|content，
// dsh-ops 用 path + edits[]|content，且**结果载荷里没有 before/after**
// （只有 revision/bytes/lineCount），所以 before 由 pre-execute 的单文件基线提供、
// after 由执行后读盘提供——见 1.3。
const WRITE_EDIT_SPECS = {
  write: { kind: 'write', pathFields: ['file_path', 'file', 'path'], contentField: 'content' },
  edit: { kind: 'edit', pathFields: ['file_path', 'file', 'path'], oldField: 'old_string', newField: 'new_string' },
  ops_write_file: { kind: 'write', pathFields: ['path', 'file_path'], contentField: 'content' },
  ops_edit_file: { kind: 'edit', pathFields: ['path', 'file_path'], editsField: 'edits' }
}
// 结果载荷不回传内容的写工具：before 走单文件基线、after 走读盘
const DISK_TRUTH_TOOLS = new Set(['ops_write_file', 'ops_edit_file'])
```

`SHELL_TOOLS` 增加 `'ops_bash'`：`new Set(['pwsh', 'bash', 'run_code', 'ops_bash'])`。

### 1.2 从入参取字段的辅助函数

```js
/** 按 spec 从入参里取路径：几个候选字段按顺序命中第一个非空字符串 */
function pathOfSpec(input, spec) { ... }
/** 把 ops_edit_file 的 edits:[{oldText,newText}] 拼成 oldString/newString：
 *  多条用 \n 连接；不是数组或空数组返回 {oldString:'', newString:''} */
function joinedEdits(input) { ... }
```

### 1.3 单文件内容基线 + after 读盘

新增 `const fileBaselines = new Map()`（与 `shellBaselines` 并列，键同样是 `exec.callId || exec.rootCallId`，同样用 `SNAP_BASELINE_TTL` 清理）。

**pre-execute**（现有 1210 行那段里追加一个分支，注意不要动原有 shell 分支）：
- 若 `DISK_TRUTH_TOOLS.has(toolName)`：
  - `const abs = absPathOf(cwd, pathOfSpec(input, spec))`
  - `before` = `readFileSync(abs,'utf8')` 成功且长度 ≤ `SNAPSHOT_MAX_CHARS` 则用它，读不到（ENOENT）记 `null`（=新建），其它异常记 `undefined`（=放弃这条记录）
  - `fileBaselines.set(callId, { abs, before, at: now })`
  - 清理过期项复用同一个 TTL 循环（可以把两个 Map 一起扫）。

**tools/result**：
- 把 `if (toolName !== 'write' && toolName !== 'edit') return`（1248 行）换成 `const spec = WRITE_EDIT_SPECS[toolName]; if (!spec) { return }`。
- `const file = pathOfSpec(input, spec); if (!file) return`（保留原来的 `file_path || file || path` 语义与顺序，即内置工具行为不变）。
- before/after 取值改成：
  ```js
  // 内置 write/edit：结果载荷直接带回全量 before/after，最准
  // ops_write_file / ops_edit_file：载荷没有内容，before 用执行前基线，after 读盘
  let before, after
  if (value !== null && ('before' in value || 'after' in value)) {
    before = 'before' in value ? snapOf(value.before) : undefined
    after = 'after' in value ? snapOf(value.after) : undefined
  } else if (spec.diskTruth) {
    const base = callId ? fileBaselines.get(callId) : null
    if (base) { callId && fileBaselines.delete(callId); before = base.before; after = readDisk(afterAbs) }
  }
  ```
  其中 `readDisk` 读不到返回 `null`（文件被工具删了）、超 `SNAPSHOT_MAX_CHARS` 或异常返回 `undefined`。
  **注意**：`before === undefined` 和 `after === undefined` 都必须让后面的 `isNoopWriteEdit` 走「判据不可用」而不是判成空操作。
- op 落盘（1295-1300）改成按 `spec.kind`：
  - `edit`：`{ kind:'edit', at, turn, before, after, oldString: cap(oldS), newString: cap(newS), via: spec.via }`，其中内置用 `input.old_string/new_string`，ops 用 `joinedEdits(input)`。
  - `write`：`{ kind:'write', at, turn, before, after, content: cap(input[spec.contentField]), via: spec.via }`。
  - **`via` 只给 ops_* 写**（值就是工具名，如 `'ops_write_file'`）；内置 write/edit 保持不写 via（客户端靠 `kind` 区分，写了会破坏既有的「内置工具徽标不带 via」约定）。

**isNoopWriteEdit** 增加一条判据：
```js
// ④ ops_edit_file 的等价判据：每一条 edit 的 oldText === newText → 必然没变
if (spec && spec.editsField) {
  const list = src[spec.editsField]
  if (Array.isArray(list) && list.length > 0 && list.every(e => e && e.oldText === e.newText)) { return true }
}
```
函数签名可以从 `(toolName, input, before, after, prevAfter)` 扩成**末尾追加** `spec`，调用点只有一处（1290），同步改。

### 1.4 ops_bash 的 workdir

pre-execute 里 shell 分支的 `cwd` 取值改成：

```js
// ops_bash 的 workdir 是入参：命令在别的目录落盘时，快照必须跟着换目录，
// 否则 git status / 目录遍历都跑在会话 cwd 上，改动一条都抓不到。
function shellCwdOf(toolName, input, baseCwd) {
  if (toolName !== 'ops_bash') { return baseCwd }
  const wd = input && typeof input.workdir === 'string' ? input.workdir.trim() : ''
  if (!wd) { return baseCwd }
  return isAbsolute(wd) ? wd : resolvePath(baseCwd || process.cwd(), wd)
}
```
需要从 `node:path` 额外导入 `isAbsolute`。**result 侧沿用基线里记下的 cwd，不要再算一次**（原来的实现就是这样，保持）。

### 1.5 历史数据清理

**配置**：`$DSH_HOME/diff-review/cleanup.json`，形如
```json
{ "version": 1, "enabled": false, "intervalHours": 6, "keepDays": 30, "keepLatest": 5, "includePrefs": true, "protectCurrent": true }
```
缺省值就是上面这份。读失败一律回落到缺省值。写入用 `mkdirSync(recursive)` + `writeFileSync`。

**扫描** `scanStateUsage()`：遍历 `stateDirPath()` 下 `*.json` 与 `ui/*.json`（`readdirSync` + `statSync`，读不了的文件跳过），返回
```js
{
  total: { files, bytes },                  // *.json 会话文件
  prefs: { files, bytes },                  // ui/*.json
  buckets: [{ key:'7d', files, bytes }, { key:'7-30d',...}, { key:'30-90d',...}, { key:'gt90d',...}],
  sessions: [{ session, bytes, mtime, ops? }]  // session 取文件名去掉 .json；不超过 200 条，按 mtime 倒序
}
```
`ops` 不必逐文件解析 JSON（文件可能 100MB+，**禁止全量 JSON.parse**）；只给 bytes + mtime 即可。

**挑选** `pickPurgeCandidates(usage, settings, protectedKeys)`：给定 `keepDays`、`keepLatest`、`protectCurrent`：
1. 按 mtime 倒序，**最近 `keepLatest` 个会话无论如何保留**；
2. 其余里 `mtime` 早于 `Date.now() - keepDays*86400000` 的进入候选；
3. `protectCurrent` 为真时，候选里**剔除本进程真正记录过改动的会话**（见下）；
4. 返回 `{ candidates:[{session,bytes,path}], keepFiles, keepBytes }`。

**「本进程记录过改动的会话」**：新增 `const touchedSessions = new Set()`，在 `markDirty(rootId)` 的调用点旁边（或直接在 `markDirty` 内部）`touchedSessions.add(sid)`。

**执行** `purgeState(opts)`：
- 对每个候选：`unlinkSync` 会话文件 +（`includePrefs` 时）`unlinkSync` 对应的 `ui/<sid>.json`；
- **必须同时 `sessions.delete(sid)`**——退出时那段 `for (const sid of sessions.keys()) persistSession(...)` 会把内存里的会话重新写回磁盘，不摘掉的话删了等于没删；
- 统计 `{ removedFiles, removedBytes, errors }`；
- 全程 try/catch，单个文件失败不影响其它。

**定时器**：`ctx.effect` 里注册，返回清理函数。逻辑：
- 读配置；`enabled` 为假就不装定时器（但配置变化时要能重新装）；
- 第一次触发延后 5 分钟（避免启动即扫全盘），之后每 `intervalHours` 小时一次；
- 每次触发前重新读一次 `cleanup.json`（用户可能在别处改了参数）；`enabled` 变假就停；
- 用 `setTimeout` 递归而不是 `setInterval`（同一时刻只有一个在跑）；
- `timer.unref && timer.unref()`，不要拖住宿主退出。

**两个 HTTP 路由**（都 `kind:'exact'`、都走 `ctx.effect(() => ctx.webServer.register(...))`，命名沿用 `'diff-review: cleanup route'`）：

`GET /diff-review/cleanup` →
```json
{ "ok": true, "settings": {...}, "usage": { "total": {...}, "prefs": {...}, "buckets": [...] },
  "preview": { "files": 0, "bytes": 0 }, "now": 1793950000000 }
```
`preview` 用当前配置算「这次能清掉多少」。

`POST /diff-review/cleanup`，body:
- `{ "action": "save", "settings": {...} }` → 校验并夹逼（`keepDays` 1–3650、`keepLatest` 0–1000、`intervalHours` 1–720、三个布尔取 `!!`），写盘、重装定时器、返回 `{ ok:true, settings }`
- `{ "action": "run", "settings": {...}? }` → 可带覆盖参数（不写盘），执行 `purgeState`，返回 `{ ok:true, removed:{files,bytes}, settings }`

POST 用现有 `readJsonBody(req)` 那套写法（照抄 `/diff-review/ui-prefs` 的 handler 结构）。

### 1.6 导出

文件末尾的 `export { ... }` 追加 `pickPurgeCandidates`、`scanStateUsage`（便于离线单测）。

## 2. 客户端侧（lib/client.js，负责人 client-impl）

### 2.1 四处名字表

- `SHELL_TOOL_LABELS`（1290 行）：`["pwsh","bash","run_code"]` → 追加 `"ops_bash"`
- `LIVE_SOURCE_EDIT`（1632 行）：`["write","edit"]` → 追加 `"ops_write_file","ops_edit_file","ops_replace"`
- 2234-2236 行来源 chip 的 tooltip 文案：把 `write / edit` 改成 `write / edit / ops_write_file / ops_edit_file`，把 `pwsh / bash / run_code` 改成 `pwsh / bash / run_code / ops_bash`
- 2288-2297 行徽标 title：三分支——ops 写工具 → `"由 dsh-ops 工具 " + tool + " 修改"`；shell 类 → 原文案；其余 → `"由内置 " + tool + " 工具修改"`。判定用 `tool.startsWith("ops_")`。

### 2.2 设置页新增「历史数据」区块

`SettingsPage`（2535 行）在原配色之后追加 `React.createElement(CleanupSection, null)`。

`CleanupSection` 要求：
- `React.useState` 存 `data`（GET 回来的整包）、`busy`、`msg`；
- `React.useEffect(() => { refresh(); }, [])` 拉一次；
- 显示：会话文件 `N 个 / X MB`、UI 偏好 `N 个 / X MB`、年龄分布四桶（≤7 天 / 7–30 天 / 30–90 天 / >90 天）、「按当前设置可清理：M 个 / Y MB」；
- 表单：保留天数（number 1–3650）、保留最近 N 个（number 0–1000）、四个开关（定时清理 / 同时清理 UI 偏好 / 保护当前会话）——注意是**三个开关 + 一个周期**：定时清理开关、周期小时（number 1–720）、同时清理 UI 偏好、保护当前会话；
- 三个按钮：「保存设置」（POST `action:'save'`）、「立即清理」（POST `action:'run'`，**执行前要 window.confirm**，文案写清会删多少个文件多少 MB）、「刷新」
- 任何操作完都重新 GET 一次刷新数字；失败显示错误文案。
- 体积格式化写一个小函数 `fmtBytes(n)`：`< 1024` → `n B`；`< 1024*1024` → `(n/1024).toFixed(1) + " KB"`；否则 `(n/1048576).toFixed(1) + " MB"`。

新增一个 HTTP 助手放 447 行那堆旁边：
```js
function apiCleanupGet() { return fetch("/diff-review/cleanup").then((r) => r.json()); }
function apiCleanupPost(body) { return fetch("/diff-review/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()); }
```

### 2.3 样式

在 CSS 字符串常量里追加 `.drv-cleanup*` 一组类，风格跟随现有 `.drv-settings-page`（13px、间距克制、不要引入新配色变量）。**不要用 `var(--dsw-…)` 之外的私有变量**，也不要新增全局选择器。

## 3. lead 负责

- `package.json`：加 `"engines": { "dsh": ">=0.2.2-rc.1 <0.2.3-0" }`；`dsh.client.inject` 删掉 `"@deepseek-ai/dsh-client-runtime"`；版本号 0.3.0 → 0.4.0。
- 双文件 `node --check`、离线假 ctx 验证（`DSH_HOME` 指向一次性临时目录，**验证完只删那个临时目录**）。
- 更新 AGENTS.md 与 README 双语。

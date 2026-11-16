# dsh-ops 0.5.0 工具面 / 入参 / 出参 / PTC 事件 取证报告

> 取证者：ops-probe ｜ 时间：2026-11-06 ｜ 共享任务：task-1
> 证据源（优先级从高到低）：
> 1. 仓库 `D:\work\github\dsh-ops`，版本 **0.5.0**，git HEAD `1a9e0e2 ci(release): keep the gate's platform skips meaningful`（只读，未改动）
> 2. DSH 本体 asar：`E:/Program/DeepseekHarness/resources/app.asar` → `@deepseek-ai/dsh-tools` **0.2.2-rc.1**、`@deepseek-ai/dsh-tool-executor-ptc`。已抽出到 `C:/Users/czy/AppData/Local/Temp/dsh-pipeline.js`（948 行 = asar `/dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js`）与 `C:/Users/czy/AppData/Local/Temp/ptc-exec.js`（1778 行 = asar `/dsh/node_modules/@deepseek-ai/dsh-tool-executor-ptc/lib/index.js`）。本报告里 ptc/pipeline 的行号都指这两个抽取件。
> 3. 运行时安装件 `C:\Users\czy\.dsh\profiles\desktop\node_modules\dsh-ops\`：package.json `version: 0.5.0`，关键文件与仓库 `diff -q` **逐字节相同**（`lib/capabilities/file.js`、`lib/shells/tool.js`、`lib/publication/ptc.js` 已实测 SAME），故下文行号两者通用。

---

## 1. 工具名全清单

### 1.1 命名规则
- `lib/policy.js:18-21`：

```js
export const TOOL_PREFIX = 'ops_'
export function publicToolName(rawName) { return ${TOOL_PREFIX}${rawName} }
export const BASH_TOOL = publicToolName(IN_PROCESS_TOOLS[0])   // => 'ops_bash'
```

### 1.2 native（标准呈现）下模型可见的公开名
来源：`lib/capabilities/registry.js` 的 `CAPABILITIES` 汇总（:40 `export const CAPABILITIES = Object.freeze([...FILE_CAPABILITIES, ...PTC_CAPABILITIES, ...SDK_CAPABILITIES, ...SHELL_CAPABILITIES, ...DISCOVERY_CAPABILITIES])`），注册时统一经 `publicToolName`（native contract `lib/projections/native/contract.js:11`；bash 走 `lib/shells/tool.js:215` 的 `name: BASH_TOOL_NAME`）。

| 公开名 | rawName | 组件 | native 可见 | resident / discoverable |
|---|---|---|---|---|
| ops_inspect_local_file | inspect_local_file | file | 是 | native 常驻（profiles.js:2）／ptc 常驻 |
| ops_grep | grep | file | 是 | 常驻（本机 profile alwaysLoaded） |
| ops_glob | glob | file | 是 | 常驻（本机 profile alwaysLoaded） |
| ops_replace | replace | file | 是 | discoverable |
| ops_write_file | write_file | file | 是 | 常驻（本机 profile alwaysLoaded） |
| ops_edit_file | edit_file | file | 是 | 常驻（本机 profile alwaysLoaded） |
| ops_diff | diff | file | 是 | discoverable |
| ops_stat | stat | file | 是 | 常驻（本机 profile alwaysLoaded） |
| ops_copy | copy | file | 是 | discoverable |
| ops_move | move | file | 是 | discoverable |
| ops_remove | remove | file | 是 | discoverable |
| ops_read_files | read_files | file | 是 | **resident**（registry.js:16） |
| ops_read_table | read_table | file | 是 | discoverable |
| ops_read_docx | read_docx | file | 是 | discoverable |
| ops_read_pdf | read_pdf | file | 是 | discoverable |
| ops_bash | bash | shell | 是 | **resident** |
| ops_result | result | ptc | 是（另有 nativeProjection） | resident |
| ops_discover_tools | discover_tools | discovery | 是 | resident |
| ops_batch | batch | ptc | 否（仅 ptc） | resident（ptc） |
| ops_load_sdk | load_sdk | sdk | 否（仅 ptc） | resident（ptc） |

依据：
- `registry.js:9` `const fileOrder = ['inspect_local_file','grep','glob','replace','write_file','edit_file','diff','stat','copy','move','remove','read_files','read_table','read_docx','read_pdf']`
- `registry.js:13-21` FILE_CAPABILITIES：`allPresentations = Object.freeze(['native','ptc'])`、`availability: rawName === 'read_files' ? 'resident' : 'discoverable'`、`ptcAvailability: rawName === 'inspect_local_file' ? 'resident' : 'discoverable'`
- `registry.js:22-29` PTC_CAPABILITIES：`presentations: rawName === 'result' ? allPresentations : ['ptc']`，`result` 另有 `nativeProjection: { component:'file', availability:'discoverable', ... }`
- `registry.js:31-34` SHELL_CAPABILITIES：`rawName:'bash'`、`presentations: allPresentations`
- `registry.js:35-39` DISCOVERY_CAPABILITIES：`rawName:'discover_tools'`、`presentations: ['native']`
- `lib/capabilities/sdk.js:8-11` SDK_CAPABILITIES：`rawName:'load_sdk'`，仅 ptc、resident
- native 常驻名单 `lib/capabilities/profiles.js:2`：`NATIVE_RESIDENT_RAW = ['inspect_local_file','glob','grep','read_files','result']`

### 1.3 PTC 呈现下的 SDK 调用名
**结论：run_code 里的 SDK 函数名 = 带前缀的公开名，即 `tools.ops_write_file(...)`、`tools.ops_edit_file(...)`、`tools.ops_bash(...)`，不是 raw name。**
- 注册名取自 `publicToolName`：`lib/projections/ptc/contract.js:16` `return { name: publicToolName(tool), description: ... }`
- SDK 绑定按注册 schema 的 `name` 生成，`ptc-exec.js:604-608`：

```js
const functions = Object.create(null);
for (const schema of tools.schemas(exec.agent, exec.toolSet)) Object.defineProperty(functions, schema.name, { enumerable: true, value: binding(deepFreeze(schema)) });
```

  `tools.schemas(...)` 给的是 Agent 可见工具的注册名（即 publicToolName 结果），所以函数键就是 `ops_*`。
- **唯一例外**：`ops_load_sdk({ tools: [...] })` 的参数用**不带前缀的 raw name**。`lib/capabilities/sdk.js:2-3` 描述原文 "1-5 exact raw OPS API names, without the public prefix"；校验在 `lib/projections/ptc/loader.js` 的 `requestedApis`（`if (typeof name !== 'string' || !allowed.includes(name)) return 'API is not in this scope’s allowed pool: ' + String(name)`），allowed 池 = `config.allowedTools`（raw name）。
- PTC 下直接调用其它工具会被拒，`ptc-exec.js:1734-1741`：

```js
get: (name, scope, toolSet) => name === RUN_CODE_NAME ? this.requirePtcTransport() : tools.executable(name, scope, toolSet),
reject: (name, nested) => !nested && name !== RUN_CODE_NAME ? new ToolNotFoundError(name, 'only `run_code` is callable directly — call `' + name + '` from inside a `run_code` program instead') : void 0
// describe(): { schemas: [projectToolSchema(this.requirePtcTransport(), false)], knownNames: [RUN_CODE_NAME] }
```

### 1.4 PTC 的可见池与常驻
- `lib/publication/ptc.js:47-48`：`resident = new Set(gate.resident === false ? [] : [...PTC_RESIDENT_TOOLS, ...config.alwaysLoaded])`；`pool = new Set([...resident, ...config.allowedTools, 'result'])`
- `lib/capabilities/registry.js:55`：`PTC_RESIDENT_TOOLS = [...FILE_CAPABILITIES, ...PTC_CAPABILITIES].filter(entry => entry.ptcAvailability === 'resident').map(entry => entry.rawName)` → 内置只有 **`inspect_local_file`** 与 **`result`**
- 本机 desktop profile 的 `ptc.alwaysLoaded` 额外挂了 read_files / glob / grep / stat / write_file / edit_file（与本会话 SDK 声明一致，实测可直接调用）
- 只读模式会剔除 mutates 工具：`ptc.js:54-55` `(api === 'load_sdk' || api === 'result' || !capability(api)?.mutates || policy.mode !== 'read-only')`
- **`ops_bash` 不走 PTC 发布池**：由 `lib/session-shells.js` 直接注册到 Agent 自己的层（`session-shells.js:224-230`），入口 `lib/consumer/mount.js:24` `if (plan.shell) ctx.inject(['tools'], inner => mountSessionBash(inner, core, shells, gate))`。PTC 只是把它当作已存在的可见工具暴露进 SDK。所以 PTC 下 `ops_bash` 的真实 schema 是 **host 变体**（含 run_in_background / sandbox_permissions / justification，见 `2.3-B）。

---

## 2. 三个关键路径的精确入参 schema

### 2.0 通用约束
- `bounded(properties, required)` = `{ type:'object', properties, required, additionalProperties: false }`（`lib/capabilities/file.js:6`）→ **file 工具一律拒绝未声明键**。
- 参数归一化会丢 `undefined`/`null`，以及**可选**字段里的空串 / 空数组（`lib/capabilities/arguments.js` 的 `normalizeArguments`，:6-31）；`required` 字段不会被丢。
- 路径口径：`lib/policy.js:82` 明文 **"Single-file tools use `path`, resolved relative to the current DSH session cwd. Use `/` separators; do not pass workspace, cwd, or `file_path` aliases."** 全仓 grep `file_path` 只有这一处命中，**没有任何 file_path 别名实现**。

### 2.1 write_file（`lib/capabilities/file.js:54`）

```js
write_file: bounded({
  path: filePath,                        // file.js:11 { ...string, description:'File path; relative to session cwd.' }
  content: { ...string, description:'Complete UTF-8 file content; empty writes an empty file.' },
  expectedRevision: revision,            // file.js:9
  dryRun,                                // file.js:14
}, ['path', 'content', 'expectedRevision'])
```

| 字段 | 类型 | 必填 | 说明 / 默认 |
|---|---|---|---|
| `path` | string | **是** | 相对 session cwd；**不是 `file_path`** |
| `content` | string | **是** | **整份文件内容**；空串 = 写空文件 |
| `expectedRevision` | string | **是** | 64 位小写 hex SHA-256，**允许字面量 "absent"（仅创建）**。file.js:9 原文：'Required: observed 64 lowercase hex SHA-256, or the literal string "absent" for create-only. Never omit or pass null/empty; never an overwrite wildcard.' |
| `dryRun` | boolean | 否 | 默认 false，只预览不写 |

工具描述（`file.js:123`）："Create or fully overwrite one UTF-8 file; parents must exist. Pass expectedRevision: "absent" for create-only, or the observed SHA-256 to overwrite. The field is required; null/empty is invalid. Atomic CAS, short receipt with new revision/bytes/lineCount; dryRun only previews. … Read-only denies even dryRun."

### 2.2 edit_file（定义 `lib/capabilities/file.js:15`，挂载 `:55`）

```js
const edits = bounded({
  path: filePath,
  expectedRevision: existingRevision,     // file.js:10
  edits: { type:'array', description:'1-100 nonoverlapping edits against the same original bytes.',
           items: bounded({ oldText: {...'Nonempty text that occurs exactly once in the original.'},
                            newText: {...'Literal replacement text; empty deletes the matched text.'} }, ['oldText','newText']) },
  dryRun,
}, ['path', 'expectedRevision', 'edits'])
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | string | **是** | 同上 |
| `expectedRevision` | string | **是** | file.js:10：'Required observed 64 lowercase hex SHA-256 from inspect/stat; **the literal "absent" is not accepted**.' → **edit_file 不能用 "absent"**（与 write_file 的硬性差异） |
| `edits` | array | **是** | 1–100 条 |
| `edits[].oldText` | string | **是** | **原文片段**（非全文），非空，且必须在原文中**唯一出现一次** |
| `edits[].newText` | string | **是** | 字面替换文本；空串 = 删除该片段 |
| `dryRun` | boolean | 否 | 默认 false |

描述（`file.js:114` EDIT_DESCRIPTION）：Atomic CAS；**CRLF/BOM 必须显式保留**（"Preserve CRLF/BOM explicitly in text"）；Windows 保留 DACL/timestamps/supported attributes。

### 2.3 bash：两个变体，schema 不同

#### A. in-process 变体（`lib/shells/tool.js:213-256` 的 `bashToolDefinition`，**无 host jobs**）
- 名称 `BASH_TOOL_NAME` = `ops_bash`（`lib/shells/constants.js:4-5` → `lib/policy.js:21`）
- 允许键白名单 `BASH_ARGUMENTS`（`constants.js:44`）：`Object.freeze(['command','description','script_path','workdir','timeoutMs','graceMs','includeDiagnostics'])`，由 `assertKnownArguments` 强制（调用点 `tool.js:268`，实现 `tool.js:52-68`；`tool.js:64` 对被拒的 `sandbox_permissions`/`justification` 给专门提示 "ops_bash has no per-call sandbox escalation; ask the user to change the session permission mode instead"）
- `parameters` **没有 `required` 数组**（tool.js:217-252）→ 所有键可省；`additionalProperties: false`（tool.js:251）
- 属性行号：command :220-223、description :224-227、script_path :228-231、workdir :232-235、timeoutMs :236-240、graceMs :241-245、includeDiagnostics :246-249

#### B. host 变体（`lib/shells/host-tool.js:10-27`，**有 `ctx.get('jobs')` 时**，本机走这条）
- `required: ['description']` —— **description 必填且非空**（`host-tool.js:15`，校验 :64-65）
- 在 A 基础上追加/覆盖（host-tool.js:15-22）：
  - `run_in_background`: boolean（**仅 jobs 存在**时出现，:19）
  - `sandbox_permissions`: enum `workspace-write` | `danger-full-access`（:20）
  - `justification`: string，**必须配 `sandbox_permissions`**（:21；校验 `lib/shells/approval.js:14` 'invalid justification: requires sandbox_permissions'）
  - `timeoutMs` 描述改为：默认 120000 ms、**上限 600000 ms**（:18；`host-tool.js:53` `Math.min(local.timeoutMs ?? 120_000, HOST_MAX_BASH_TIMEOUT_MS)`，`HOST_MAX_BASH_TIMEOUT_MS = 600_000` @ :9）
- 未声明键一律拒：`host-tool.js:45-47` "invalid arguments: unknown key ...; this tool accepts ..."

#### 共同语义（两变体一致，`tool.js` 的 `resolve`）
| 字段 | 类型 | 必填 | 默认 / 约束 |
|---|---|---|---|
| `command` | string | **与 script_path 二选一、且只能给一个** | 空串/`null` 视为未给（tool.js:283-284）；两者都给 → `'invalid bash input: provide exactly one of command or script_path; for commands omit script_path or set it to "", not /dev/null'`（tool.js:295）；两者都没 → tool.js:292 |
| `script_path` | string | 同上 | 已存在脚本文件；**永远用 Bash 执行**，与扩展名无关；勿用 `/dev/null` 占位 |
| `workdir` | string | 否 | 相对 session workspace，默认 = workspace；必须是已存在目录（`lib/session-shells.js` 的 `sessionWorkdir`，Windows 盘符/路径形态有专门报错，见 :77-100） |
| `timeoutMs` | number | 否 | in-process 默认 **120000**（`constants.js:22` `DEFAULT_BASH_TIMEOUT_MS = 120_000`）、上限 2147483647（`constants.js:24`）；host 变体上限 **600000**。必须正有限数（tool.js:297-301） |
| `graceMs` | number | 否 | 默认 **3000**（`constants.js:30` `DEFAULT_GRACE_MS = 3_000`） |
| `includeDiagnostics` | boolean | 否 | 默认 false |
| `description` | string | **host 变体必填**（非空，5–10 词）；in-process 可省 | 仅为兼容 host shell tool |
| `run_in_background` | boolean | 否 | 仅 host 变体；true 立即返回 `kind:'background'` + jobId |
| `sandbox_permissions` / `justification` | string / string | 否 | 仅 host 变体；只允许**比当前更宽**的模式（`approval.js:19` 'the requested mode is narrower than the current mode'） |

输出上限：`DEFAULT_MAX_OUTPUT_BYTES = 64_000`/流（`constants.js:32`）、spill 上限 64 MiB（`constants.js:34`）。

---

## 3. 返回形态（Outcome）与 native / ptc 差异

### 3.1 共同事实：失败是**返回值**，不是异常
- file 工具描述统一追加（`lib/capabilities/file.js:113`）：

```js
const RESULT = ' Failures resolve as {status:"error"|"rejected", error.code}; they are not thrown.'
```

  该句被拼进每个 DESCRIPTIONS（:123、:124 等）；`lib/kernel/errors.js:7` 另注 "Stable native/host codes retain their spelling."
- PTC 契约在外层再兜一层（`lib/projections/ptc/contract.js:21-29`）：`try { return toOutcome(tool, args, await execute(args, exec)) } catch { return toOutcome(tool, args, { status:'unknown', error:{ code:'RESULT_UNKNOWN', effectState:'unknown', ... } }) }`

### 3.2 native 呈现
- 定义 `lib/projections/native/contract.js:9-21`：

```js
return { name: publicToolName(rawName), description: DESCRIPTIONS[rawName], parameters: PARAMETERS[rawName],
  output: { schema: fileOutput(rawName), render: (args, value) => [{ type:'text', text: renderNative(rawName, args, value) }], presentationMeta }, execute }
```

- 即返回**原始 canonical 对象**（`OUTPUT` / `READ_FILES_OUTPUT` / `SEARCH_OUTPUT`，`file.js:68-111`），由 `renderNative`（`lib/projections/native/render.js:178`）渲染成人读文本；schema 仍是 canonical 对象 schema。
- `OUTPUT` 关键字段（file.js:68-83）：`status`、`revision`、`bytes`、`lineCount`、`changed`/`matched`/`skipped`/`failed`、`complete`、`nextOffset`、`truncated`、`items`、`dryRun`、`files`/`matches`/`skippedFiles`、`error: { type:'object' }`、`reference`/`referenceRoot`/`root`/`source`/`storageError`/`nextAction`
- 搜索类（`SEARCH_OUTPUT`，file.js:96-104）另加 `scanComplete`/`pageComplete`/`scannedFiles`/`skipReasons`/`matchedObserved`/`matchedTotal`/`truncatedBy`（enum `scan-budget|output-budget|time|row-limit|none`）/`continuation`

### 3.3 PTC 呈现
- 定义 `lib/projections/ptc/contract.js:11-30`：

```js
return { name: publicToolName(tool),
  description: entry.description.replace(/ Failures resolve as .*?they are not thrown./, '') + ' PTC returns Outcome: completed.data; partial.data, coverage and continuation; failures use error.code/effectState/retry. ...',
  parameters: entry.parameters, timeoutMs: WORKER_TIMEOUT_MS + 2000,
  output: { schema: outcomeSchema(canonicalOutput(tool)), render: (_args, value) => [{ type:'text', text: JSON.stringify(value) }] }, execute }
```

- 三态（`lib/projections/ptc/outcome.js:26-76`；schema `lib/projections/ptc/schema.js:12-18`）：
  - **completed**：`{ status:'completed', data, coverage? }`（coverage 仅当 `data.scanComplete` 是 boolean，outcome.js:74-75）
  - **partial**：`{ status:'partial', data, coverage:{..., isComplete:false}, continuation }`（有安全游标时，outcome.js:68-71）
  - **失败**：`{ status:'rejected'|'conflict'|'error'|'unknown', error:{ code, message, effectState, retry, nextAction? }, data? }`（`failure()` @ outcome.js:13-17；ERROR_SCHEMA @ schema.js:7-9：`effectState ∈ none|applied|partial|unknown`、`retry ∈ never|after-input-change|after-state-change|bounded-transient`）
- 错误码 → (status, retry) 映射 `lib/kernel/errors.js:8-54`（`REVISION_CONFLICT → conflict / after-state-change`、`INVALID_ARGUMENT → error / after-input-change`、`POLICY_DENIED → rejected / never`、`RESULT_UNKNOWN → unknown / never` 等）；`errorPolicy(code, effectState)` @ errors.js:56-62：**effects 主导**（`effectState:'unknown'` 恒 `unknown/never`）。
- 渲染：PTC 下文本是 `JSON.stringify(value)`（contract.js:19）。

### 3.4 差异总结
| 维度 | native | PTC |
|---|---|---|
| 执行体 | 同一个（file worker / bash 子进程），**仅呈现层不同** | 同左 |
| 输出 schema | canonical 对象 | Outcome 三态 oneOf |
| 渲染 | `renderNative` 人读文本 | `JSON.stringify` |
| 失败 | 返回 `{status:'error'|'rejected', error.code}` 的 canonical 对象 | 包成 `{status, error:{code,message,effectState,retry}}` |
| 异常 | 不抛（描述明文） | 也不抛（contract 兜 `RESULT_UNKNOWN`） |
| 超时 | — | `timeoutMs: WORKER_TIMEOUT_MS + 2000`（contract.js:17） |

### 3.5 bash 的成功/失败判定
- `lib/shells/tool.js:178-182` 的 `withBashStatus`：只有 `exitCode === 0` 且无 `error`/`permission`/`restriction`、`signal == null`、`timedOut !== true`、`cancelled !== true` 才是 `status:'completed'`，否则 `'failed'`。
- 输出 schema `BASH_OUTPUT_SCHEMA`（`tool.js:127-174`，required `['status','timedOut','timeoutMs','stdout','stderr']`；`stdout`/`stderr` 各含 `text`+`truncated` 且都必填）。
- host 变体输出是三态 oneOf（`lib/shells/host-contract.js:5-23`）：
  - `kind:'background'` → `{ kind, jobId, label }`
  - `kind:'promoted'` → `{ kind, jobId, label, timeoutMs, output }`（前台超时被升级为后台 job）
  - `kind:'foreground'` → BASH_OUTPUT_SCHEMA + `kind/exitCode/signal/aborted`（exitCode、signal 可为 null），失败时另带 `failure:{ code, message, effectState: none|unknown, retry: never|after-input-change, nextAction? }`

---

## 4. 文件内容如何进入工具参数（重点）

### 4.1 write_file：**整份文件内容**
- `content` 描述就是 "Complete UTF-8 file content; empty writes an empty file."（`lib/capabilities/file.js:54`）。模型必须把目标文件全文重新产出，配合 `expectedRevision` 做 CAS。
- 后果：**改动面天然是「整个文件」**，不是「改了哪几行」——要得到行级 diff，只能拿旧内容（`expectedRevision` 对应版本 / 上次记录）与新内容自己算。

### 4.2 edit_file：**片段**（oldText/newText）
- `edits[].oldText` = "Nonempty text that occurs exactly once in the original."；`edits[].newText` = "Literal replacement text; empty deletes the matched text."（file.js:15）
- 1–100 条，全部针对**同一份原始字节**且互不重叠 → 天然带「改了哪几处」的结构，但**仍不带行号**（要行号/上下文得自己按原文定位）。
- 因为是片段，单条 op 的「改动前后全文」不在参数里，只在 `expectedRevision` 所代表的那份状态里。

### 4.3 bash：**拿不到任何文件清单**
- `ops_bash` 的入参（`2.3）与出参（`3.5）里**没有任何文件路径清单 / 改动摘要字段**；出参只有 stdout/stderr/exitCode/signal/timedOut/diagnostics/spillPath 等。
- **dsh-ops 源码内没有 git 快照能力**：全仓 grep `git status` / `git show` / `git diff` 在 `lib/**/*.js` **零命中**；`lib/review/*` 只处理 GitHub PR 快照（远端 API），与本地文件改动无关。
- 宿主（`@deepseek-ai/dsh-tools` pipeline）同样不做快照：`tools/result` 只给 `(exec, result)`，result 是工具自己的 canonical 值。
- 因此「bash 改了哪些文件」**只能靠外层插件做执行前后快照差** —— 本仓库（dsh-change-review）现在的做法：
  - `lib/index.js:1210-1230` `ctx.on('tools/pre-execute')`：命 `SHELL_TOOLS` 时用 `snapshotOf(cwd, knownPathsOf(resolveRootId(agentId)))` 存基线，键 `exec.callId`；
  - `lib/index.js:1232-1246` `ctx.on('tools/result')`：取基线、`setImmediate(() => recordShellChanges(shellAgentId, base.cwd, base.snap, toolName))`；
  - `lib/index.js:1143-1203` `recordShellChanges`：`diffSnapshot` → 逐文件 `readFileSync` → 与上一条 op 的 `after` 比（`normalizeEol` 归一）→ push `{kind:'write', before, after, content, via}`（:1197）。
  - 已知边界（同 AGENTS.md）：仓库外且从未被 write/edit 记录过的文件抓不到；单命令最多 50 个文件；git 不可用时退化为有界目录遍历。

---

## 5. PTC 下 run_code 内层调用是否产生独立的 tools/result 事件？（重点，**已确证：会**）

**结论：会。** 内层每次 SDK 调用都走完整 pipeline 并派发 `tools/result`，`exec.name` = 该工具注册的公开名（`ops_write_file` 等），`exec.parent` = 父 exec.token，`exec.callId` = `<rootCallId>:ptc:<n>`。

### 5.1 源码链路
1. `ptc-exec.js:495-511` 每次绑定调用构造 input：

```js
const n = ++dispatches;
const subCallId = brandString(${String(exec.callId)}:ptc:${n});
const input = { callId: subCallId, rootCallId: exec.rootCallId, name, schema, arguments: normalized.dispatched,
                ...exec.agent ? { agent: exec.agent } : {}, ...exec.toolSet !== void 0 ? { toolSet: exec.toolSet } : {},
                parent: exec.token, signal: runController.signal };
```

2. `ptc-exec.js:556-596` 的 `start()`/`commit()`：`executor.prepare(input)` → `executor.dispatch(prepared.exec)` → `await executor.complete(parked.exec, parked)`
3. `dsh-pipeline.js:521-542` `complete()` → `this.finish(exec, postResult)`；`:551-566` `finish()` → `this.notifyResult(exec, finalResult)`
4. `dsh-pipeline.js:578-596` `notifyResult()` 真正派发：

```js
const callbacks = this.ctx.events.dispatch("emit", [ scopeTarget(this.tools, exec.agent), "tools/result", exec, result ]);
```

5. `dsh-pipeline.js:293-322` `createExecution(exec)` 把 `callId / rootCallId / name / agent / parent / toolSet` 原样搬进新 exec（`...parent !== void 0 ? { parent } : {}`）→ **嵌套关系保留**。

### 5.2 旁证
- dsh-ops 自己的 `tools/result` 监听都显式过滤嵌套：`lib/projections/native/read-dedup.js:46` `if (!exec.agent || exec.parent) return;`、`lib/projections/native/read-observation.js:35` `if (exec.parent || !exec.agent || result.isError || ...) return;` —— 说明嵌套 exec 确实会到达 `tools/result`。
- 会话日志另有专门事件：`tool/ptc-dispatch-start`（ptc-exec.js:557）与 `tool/ptc-dispatch`（ptc-exec.js:533）；事件类型名同样登记在 `session-index.js:133-134`。

### 5.3 实测（本会话 2026-11-06 15:10）
用官方 `write` 与 `ops_write_file` 各写一个探针文件，再读状态文件 `C:\Users\czy\.dsh\diff-review\session-b8302266-d0ce-44b1-83d5-fc6fe77d5d2c.json`：

```
D:\work\github\dsh-change-review\.handoff\_probe_official_write.txt
  { kind:"write", content:"hello official write" }          ← 无 via 字段 = write 工具分支（lib/index.js:1299）
D:\work\github\dsh-change-review\.handoff\_probe_ops_write.txt
  { kind:"write", via:"run_code", content:"hello ops write\n" }  ← via='run_code' = shell 快照分支（lib/index.js:1197）
```

**这条实测同时证明两件事**：
1. `ops_write_file` 在 run_code 内的调用**确实产生了 tools/result**（否则整条记录都不会出现）；
2. 但它的 `exec.name` 是 **`ops_write_file`**，不匹配本仓库记录分支 `if (toolName !== 'write' && toolName !== 'edit') return`（`lib/index.js:1248`），因此**没被 write/edit 分支认领**，最终由外层 `run_code` 的 shell 快照差兜住（于是 `via:'run_code'`、`before/after` 来自磁盘快照而非工具 payload）。

### 5.4 对本仓库的直接含义（供 lead 决策，未改代码）
- `SHELL_TOOLS = new Set(['pwsh','bash','run_code'])`（`lib/index.js:253`）。PTC 下 **`ops_bash` 的注册名是 `ops_bash`，不在集合内** → `ops_bash` 自己的 `tools/result` 不触发快照分支；其改动之所以仍被记录，是因为**外层还包着一层 `run_code`**（run_code 在集合内，前后各拍一次快照）。
- 反过来，若未来把 `ops_bash` 加成独立事件源，注意 `ops_bash` 也可能被**直接**调用（native 呈现 / 非 run_code 路径），那时没有外层 run_code 兜底。
- 同理：`ops_write_file` / `ops_edit_file` / `ops_replace` / `ops_copy` / `ops_move` / `ops_remove` 的 `tools/result` 都到达本仓库，但**名字不在 `['write','edit']` 内**（`lib/index.js:1248`）；入参字段是 `path` 而非 `file_path`（`lib/index.js:1251` `input.file_path || input.file || input.path` 恰好能取到 `path`，但因名字先被挡掉，这一行实际跑不到）。要让这类 op 走「精确 payload」路径（带 before/after、可撤回、不必等快照），需按名字 + 字段分别适配。

### 5.5 内层 exec 上有没有"入参"字段（已追到源码）
**有 `exec.arguments`，没有 `exec.input`。**
- `dsh-pipeline.js:293-322` 的 `createExecution` 先建 `base`（只含 token/callId/rootCallId/name/signal/agent/toolSet/parent/schema/deferContext/concludeTurn，**不含 input/arguments**）。
- 随后 `dsh-pipeline.js:325-330` 补上参数快照：
  ```js
  const detached = snapshotJsonValue(exec.arguments);
  if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
  const execution = { ...base, arguments: deepFreeze(detached) };
  ```
  来源就是 `ptc-exec.js:506` 的 `arguments: normalized.dispatched`（内层调用经 `jsonNormalizeArgs` 归一后的实参）→ **`tools/result` 监听里可以直接读 `exec.arguments.path` / `exec.arguments.edits` 等**。
- 因此本仓库 `exec.input || exec.arguments || exec.args`（`lib/index.js:1249`）在嵌套场景**能取到值**（走第二项）——只是要先放开 `lib/index.js:1248` 的名字闸门。

### 5.6 明确列为「未确证」
- **未确证**：dsh-ops 是否有未发布分支提供 bash 改动清单（本次只核 0.5.0 + HEAD `1a9e0e2`，未看其它分支/PR）。
- **未确证**：`ops_bash` 在 PTC 下走 host 变体（`lib/shells/host-tool.js`）这件事，是从 `lib/consumer/mount.js:24` `mountSessionBash` 的调用链推出来的；本会话没有对 `ops_bash` 的 schema 做运行时反射（工具描述文本里确实出现了 `run_in_background`/`sandbox_permissions`，与此一致）。

---

## 6. 附：本次核对过的文件清单
仓库侧：`lib/policy.js`、`lib/capabilities/{registry,file,sdk,arguments,profiles}.js`、`lib/projections/native/{contract,render,read-dedup,read-observation}.js`、`lib/projections/ptc/{contract,outcome,schema,directory,loader}.js`、`lib/publication/ptc.js`、`lib/consumer/mount.js`、`lib/ptc/config.js`、`lib/shells/{tool,constants,host-tool,host-contract,approval,prompt,job-wait-guidance}.js`、`lib/session-shells.js`、`lib/kernel/errors.js`、`lib/execution/*`、`lib/file/*`。
宿主侧（抽取件）：`dsh-pipeline.js`（prepare / createExecution / complete / finish / notifyResult）、`ptc-exec.js`（binding / createRunCodeTool / describe / reject）。
本仓库侧（对照用）：`lib/index.js:253 / 1143-1203 / 1210-1246 / 1248-1303`。

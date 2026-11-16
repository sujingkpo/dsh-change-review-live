# DSH 0.2.2-rc.1 兼容取证报告（dsh-change-review-live 0.3.0）

> 取证对象：安装件 `E:\Program\DeepseekHarness\resources\app.asar`（213,202,918 B）内的 `dsh/`。
> 版本实测：`dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime` **0.2.2-rc.1**；`dsh/node_modules/@deepseek-ai/dsh/package.json` = **0.2.2-rc.1**。
> 对照件：npm 全局 `@deepseek-ai/dsh` = 0.2.1-rc.2（仅作对照，结论以 asar 为准）。
> 取证方式：只读。`app.asar` **未解包**（`app.asar/dsh/` 不是目录），用自写读取器 `C:/Users/czy/AppData/Local/Temp/asarread.cjs`（ls / cat / stat）与 `asarsearch.cjs`（search）直接解析归档；下文「asar: 路径:行号」均指 asar 内文件的行号。
> 结论口径：**确定兼容** / **有变化**（说明改了什么、是否仍可用）/ **查不到**（说明查了哪里）。
> 本文件只做取证，未改动插件任何代码。

---

## 0. 总览

| # | 检查项 | 结论 |
|---|---|---|
| 1 | Host 事件名 `tools/result` `tools/pre-execute` `session/event` `tools/change` `ctx.effect` `webServer.register` `agents.store` | **确定兼容**（事件名全在；`tools/change` 存在但本插件未用） |
| 2 | `tools/result` / `tools/pre-execute` 载荷字段 | **有变化但兼容**：`exec.name` / `exec.arguments` 是正式字段，无 `exec.tool` / `exec.input`；插件已用 `name || tool`、`input || arguments || args` 兜底，工作正常。`exec.agent.session.header.cwd` 与 `ctx.agents.get(id).session` **实测存在**（非声明面） |
| 3 | 内置工具名 write / edit / pwsh / bash / run_code | **确定兼容**（五个名字全部保留） |
| 4 | 客户端席位 `sidebar.right.pane.tab` / `.tab.title` / `conversation.input.dock` | **确定兼容**（席位在、`key`/`id`/`order` 语义一致、`useTabInfo`/`tab.contentId` 保留） |
| 5 | `useResource` / `openResource` / `dsh-resource://` 协议 | **确定兼容**（`openResource(address, options?)` 单参调用兼容；`dsh-resource://file/session/<sid>/<path>` 语法未变） |
| 6 | `dsh.client.inject` 的 5 个包 | **4 个确定兼容**（存在且版本 0.2.2-rc.1）；**`@deepseek-ai/dsh-client-runtime` 查不到**（整个 asar 0 命中，但**不影响加载**） |
| 7 | 缺失 `engines` / `peerDependencies` / `dsh.compatibility` 的后果 | **确定兼容**：两者皆缺 → 兼容性判定返回 undefined → **不告警、不拒载** |

**一句话结论**：本插件 0.3.0 在 DSH 0.2.2-rc.1 上**依赖面没有破坏性变化**，可正常装载运行；唯一「查不到」的 `dsh-client-runtime` 是一个**从来就不存在**的包名，装载器对未命中 inject 项是静默跳过，无功能影响（但属于可以顺手清掉的脏数据，见 §5）。

---

## 1. Host 侧事件与 API

### 1.1 权威清单位置

宿主 API 目录（TypeScript 声明级，10257 行）：
`asar: dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js`
（已导出副本 `C:/Users/czy/AppData/Local/Temp/api-catalog.js`）

### 1.2 事件名逐项核对 —— **确定兼容**

| 事件 | 目录行号 | 精确签名（原文） |
|---|---|---|
| `session/created` | api-catalog.js:5106 | — |
| `session/disposed` | api-catalog.js:5114 | — |
| **`session/event`** | api-catalog.js:5122 | `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void` |
| `session/flush` | api-catalog.js:5130 | — |
| **`tools/change`** | api-catalog.js:5202 | emit，无参（本插件**未使用**，仅任务点名核对） |
| `tools/execute` | api-catalog.js:5210 | `(exec: ToolDispatchExecution, next) => Promise<ToolExecutionResult>` |
| `tools/post-execute` | api-catalog.js:5218 | 带 result + next 的 waterfall |
| **`tools/pre-execute`** | api-catalog.js:5226 | `'tools/pre-execute'(this: Scoped<ToolsService>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>` |
| `tools/ptc-dispatch-log` | api-catalog.js:5234 | — |
| **`tools/result`** | api-catalog.js:5242 | `'tools/result'(this: Scoped<ToolsService>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined` |
| `webserver/index-inject` | api-catalog.js:5258 | — |

与插件实现比对（插件只用 3 个）：

- `lib/index.js:1210` `ctx.on('tools/pre-execute', async (exec, next) => { … return next() })` —— 两参 waterfall、末尾必须 `return next()`，与 0.2.2-rc.1 签名**逐字一致**（`next()` 委托 allow）。
- `lib/index.js:1232` `ctx.on('tools/result', (exec, result) => …)` —— 两参 emit，**一致**。
- `lib/index.js:1312` `ctx.on('session/event', (session, event) => …)` —— 两参 post-commit，**一致**。

实际派发路径（不是只查声明）：

- `tools/result`：`asar: dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js:578` `notifyResult(exec, result)` → :586 `this.ctx.events.dispatch("emit", [scopeTarget(this.tools, exec.agent), "tools/result", exec, result])`；:588-593 对每个回调 `try { callback(exec, result) } catch { … logger.warn }` —— **观察者抛错只记 warn，不污染工具结果**（插件 1210/1232 外层都包了 try/catch，双保险）。
- `session/event`：`asar: dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js:1596` 在 `commit()` 中构造 `callbackArgs = [this, event]`，:1600 `this.log.push(event)`（**先入日志**），:1601 才 `invokeContainedSessionObservers(…, "session/event", …, callbackArgs, callbacks)` —— 插件注释里「事件先入日志再派发」的前提**仍然成立**（广播时 summary 已能看到该 turn/start）。
- `turn/start` 事件类型：`asar: dsh/node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js:79` 仍在清单内。

### 1.3 `ctx.effect` —— **确定兼容**

- 声明：api-catalog.js:10162「Register a disposable side effect tied to the fiber.」
- 实现：`asar: dsh/node_modules/@deepseek-ai/cordis/lib/index.js:463` `effect(execute, label = "anonymous") { this.assertActive(); … }` —— 与插件 `ctx.effect(() => …, 'diff-review: …')`（`lib/index.js:890`、:1700 起 13 处路由注册）用法一致（第二参数 label 保留）。

### 1.4 `webServer.register` —— **确定兼容**

- 目录条目：api-catalog.js:4293 `key: 'webServer'`；方法 :4305 `register(route: WebRoute | WebResourceRoute): () => void`。
- 类型：api-catalog.js:9918 `interface WebRoute { kind: WebRouteKind; path: string; handler: (req, res) => void | Promise<void> }`；:9922 `type WebRouteKind = 'exact' | 'prefix'`。
- 插件 `lib/index.js:1701` 起全部用 `kind: 'exact'` + `path` + `handler`（13 条路由：events / summary / file / turn / against / revert / clear / ui-prefs / editors / open-with-editor / editor-icon / open / reveal）—— **契约一致**。

### 1.5 `agents.store` / `ctx.agents` —— **确定兼容**

- `asar: dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js`：`var AgentRegistry = class extends Service`（:441 前后）内 `store = new Map()`；:641 `enter(agent, owner)` 写入 `{ id, agent, owner, carrier, announced, … }`；:725 `get(id) { return this.store.get(id)?.agent; }`；:736 `isOwnedBy(id, owner) { return this.store.get(id)?.owner === owner; }`。
- ⇒ 插件 `resolveRootId` 依赖的「`ctx.agents.store.get(id)` 条目带 `agent` 与 `owner`」**仍然成立**（`lib/index.js:922`、:1091）。

### 1.6 `ctx.get('sidebarRight')` —— 客户端侧，**确定兼容**

- `asar: dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js:5599` `ctx.reflect.provide("sidebarRightTabs", tabs)`；:5600 `ctx.reflect.provide("sidebarRight", controller)`。
- 插件 `lib/client.js:325` `ctxRef.get("sidebarRight")`、:3009 `ctxRef.get("sidebarRightTabs")` —— 两个服务名**都在**。

---

## 2. `tools/result` / `tools/pre-execute` 载荷字段

### 2.1 类型声明（**有变化**：正式字段是 name / arguments，没有 tool / input）

api-catalog.js:9493-9505：

```ts
export interface ToolExecutionInput {
    readonly callId: ToolCallId;
    readonly rootCallId?: ToolCallId;
    readonly name: string;
    readonly schema?: ToolSchema;
    readonly arguments: unknown;
    readonly agent?: Agent;
    readonly toolSet?: ResolvedToolSet;
    readonly parent?: ToolExecutionToken;
    readonly signal: AbortSignal;
}
export interface ToolExecution extends ToolExecutionInput {
    readonly rootCallId: ToolCallId;
    readonly token: ToolExecutionToken;
}
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;
export interface ToolExecutionSuccess { readonly isError: false; readonly value: JsonValue; readonly content: ContentBlock[]; … }
export interface ToolExecutionFailure { readonly isError: true; readonly error: ToolFailure; readonly content: ContentBlock[]; … }
```

实际构造（`asar: dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js:296` `createExecution(exec)`）：

```js
const callId = exec.callId;
const rootCallId = exec.rootCallId ?? callId;
const name = exec.name;
const agent = exec.agent;
…
const execution = { ...base, arguments: deepFreeze(detached) };
```

⇒ **不存在 `exec.tool`，不存在 `exec.input`**。`exec.arguments` 是 deepFreeze 后的快照。

**插件兼容性判定（有变化但兼容）**：插件三处都写了别名兜底，兜底顺序恰好覆盖：

- `lib/index.js:1213` `const toolName = exec && (exec.name || exec.tool)` ✅ 命中 `name`
- `lib/index.js:1234` `const toolName = exec.tool || exec.name` ✅ 命中 `name`
- `lib/index.js:1246` `const input = exec.input || exec.arguments || exec.args` ✅ 命中 `arguments`

### 2.2 `exec.agent` 与 `exec.agent.session` —— **实测存在（非声明面）**

`Agent` 在 api-catalog.js:5417 附近**只声明了 `readonly id: SessionId`**，看不到 `session` 字段。但这是接口声明的窄化，运行期对象是 `ReactLoopAgent`：

- `asar: dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:511` `var ReactLoopAgent = class {` → :515 字段声明 `session;` → :540 构造函数 `this.session = session;`（同文件 :531 起另有 `id`、:1583 注册进 registry）。
- `asar: dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:964` 调工具时传 `agent: this`（即 `ReactLoopAgent` 实例）：

```js
const result = await this.loopCtx.tools.execute({
    calls: toolCalls, signal, agent: this, log: { turn, step }, maxParallelToolCalls, toolSet: decision.toolSet,
});
```

- `asar: dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js:625` 转发 `agent: exec.agent`；最终 `tools/result` 的 `exec.agent` 就是该 `ReactLoopAgent`。
- `Session` 侧：`asar: dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js:1342` `header;`、:1346 `get id() { return this.header.id; }`，`header.cwd` 由 :1048-1049 强校验存在且为绝对路径（`"session header cwd must be a string"` / `"… must be an absolute path"`）。

⇒ 插件 `lib/index.js:1222` 与 :1263 的

```js
const cwd = exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
```

**成立**；`ctx.agents.get(id).session`（`lib/index.js:919`）同样成立（registry 的 `get` 返回 `ReactLoopAgent`，其 `.session` 即 `Session`）。`sessionOf()` 还带 `isSessionLike()` 校验（`snapshotEvents` 函数或 `events` 数组），而 `snapshotEvents(fromSeq, toSeqExclusive)` 在 `dsh-session/lib/index.js:1454`、`ownEvents()` 在 :1467 仍在。

### 2.3 `result` 形状

插件 `lib/index.js:1282`（失败判据在 :1255）：
```js
const value = result && !result.isError && result.value && typeof result.value === 'object' ? result.value : null
const failed = result && (result.isError || result.error || result.ok === false || result.failed)
```
成功分支 `isError: false` + `value: JsonValue`、失败分支 `isError: true` + `error` —— 与 api-catalog.js:9499-9507 的 `ToolExecutionSuccess` / `ToolExecutionFailure` **逐字段对得上**（`ok`/`failed` 是多余的旧判据，不会误伤）。

### 2.4 write / edit 输出 schema（插件 `before`/`after` 数据来源）

`asar: dsh/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js`

- `write`（:549 `name: "write"`）输出 schema（:565-589）：`path`（string, required）、`operation`（`"create" | "update"`, required）、`before`（`oneOf [string, null]`, **required**）、`after`（string, required）。
- `edit`（:1459 `name: "edit"`）输出 schema：`path`、`before`（string, required）、`after`（string, required）。
- 入参：`write` = `{ file_path, content }`；`edit` = `{ file_path, old_string, new_string, replace_all? }`（`replace_all` 默认 false，`old_string === new_string` 直接抛错）。

⇒ 插件 `'before' in value` / `'after' in value` 判定（:1283-1285）依旧安全；`before === null` 仍表示新建。

---

## 3. 内置工具名 —— **确定兼容（五个全在）**

| 工具 | 证据 |
|---|---|
| `write` | `asar: dsh/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js:549` `name: "write"` |
| `edit` | `asar: …/dsh-tool-fs/lib/index.js:1459` `name: "edit"` |
| `pwsh` | `asar: dsh/node_modules/@deepseek-ai/dsh-tool-pwsh/lib/index.js:466` `name: "pwsh"` |
| `bash` | `asar: dsh/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js:493` `name: "bash"` |
| `run_code` | `asar: dsh/node_modules/@deepseek-ai/dsh-tool-executor-ptc/`：README.md:12「only `run_code` is directly callable」；lib/index.js:86「PTC mode `run_code` transport」、:288 `if (directories === void 0) throw new Error("dsh-tools: run_code with an Agent requires workingDirectory")` |

插件 `lib/index.js:253` `const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])` —— **三个名字与实现一致**，shell 快照路径不会因改名而失效。

---

## 4. 客户端席位与侧栏协议

### 4.1 `sidebar.right.pane.tab` / `.tab.title` —— **确定兼容**

- 运行期注册处：`asar: dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js:1502` 附近（Tab 域注释）与插槽目录。
- 插槽目录（客户端 API 目录，`C:/Users/czy/AppData/Local/Temp/ccr.js` = `asar: dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`）：
  - `ccr.js:6326` `key: "sidebar.right.pane.tab"`，`kind: "keyed"`、`scope: "session"`；
    摘要原文：「One tab's body, dispatched with the `id` of the type in force for `tab.kind`.」
    `registerOptions`：`{ name: "key", requirement: "required", type: "string" }`，文档：「Your cell key: the entry renders where the owner dispatches this exact key.」
    `hookContext: "TabHookContext"`、`slotInject: "SidebarRightTabInjected"`、`declaredBy: "an entry in 'rightbar.session' (client-ui-sidebar-right)"`。
  - `ccr.js:6384` `key: "sidebar.right.pane.tab.title"`，同样 `keyed` / 必填 `key` / 同一 `TabHookContext`。
- 插件注册（`lib/client.js:3029`、:3036）均用 `key: DIFF_TAB_ID`（= tab 类型 `id`）—— **与「按类型 id 分发」的语义一致**。

### 4.2 `useTabInfo()` —— **确定兼容**

`asar: dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js:5436`（`tabInfoFactory` 返回的 `useTabInfo`）：

```js
return {
    sidebar: { expanded: layout.expanded, fullscreen },
    panel: { id: pane.id, isFloating: pane.host === "float" },
    tab: { ...tab, visible: active && (…), navigation, signal, actions,
           refreshShortcut: shortcuts.find((row) => row.id === "page.refresh") },
};
```

⇒ 插件读取的 `tab.contentId`（来自 `...tab` 展开、且 tab 记录本身带 `contentId`：同一文件 :831 `contentId: zod.z.string().min(1)`、:984 `contentId: pageAddress(initial.kind)`）、`tab.visible`、`tab.signal` **三项都在**。

### 4.3 `conversation.input.dock` —— **确定兼容**

- 插槽目录 `ccr.js:3696`：`kind: "list"`、`scope: "session"`，摘要「Full-width entries above the composer card；fixed overlays must portal to the document body」；
  `registerOptions` = `id`（required，string）、`order`（optional，number，默认 0）、`label`（optional）；
  `ownerProps: ["InputZone { readonly session: SessionSnapshot; readonly input: InputState }"]`。
- 宿主侧真实注册样例（`asar: dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`）：
  - :19937 `ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "queue", order: 20, locale: NS, inject: (sessionId) => … }, …))`（真实 6 参 `inject` 工厂，返回对象）
  - :22356 `… id: "todo", order: 0 …`
- 插件 `lib/client.js:2982` `ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "diff-review-live", order: 20, inject: (sessionId) => ({ sessionId }) }, LivePanel))` —— `id`/`order`/`inject` 三项语义**完全对得上**（官方样例本身就用 `inject: (sessionId) => ({…})`）。

### 4.4 插件另注册的三个席位 —— **都在目录中**

| 席位 | 目录证据 | 插件位置 |
|---|---|---|
| `conversation.session.header.actions` | `ccr.js:4230` | `lib/client.js:2985` |
| `settings.section` | `ccr.js:5747`（`declaredBy` 提及）+ :5805 示例 | `lib/client.js:2988` |
| `sidebar.footer.action` | `ccr.js:6179` | `lib/client.js:2991` |

### 4.5 `useResource` / `openResource` / `dsh-resource://` —— **确定兼容**

- 侧栏服务：`asar: …/dsh-client-ui-sidebar-right/lib/client.js:2494` `openResource(address, options = {}) { const { sessionId, actions } = this.require(); this.placeResource(sessionId, actions, address, options); }` —— **第二参数有默认值**，插件 `lib/client.js:416` `svc.openResource(address)` 单参调用**不报错**。
- 另有 :2515 `openResourceIn(sessionId, address, options)`；:2240 Tab 上下文内的 `openResource: (address, options = {}) => navigator.openResourceIn(…)`。
- 资源地址语法（`asar: dsh/node_modules/@deepseek-ai/dsh-util-workspace-path/README.zh.md:25`）：「资源地址 = `dsh-resource://<type>/…`，type（URI 的 host）即资源协议键（`file`，或插件在 `ResourceProtocolMap` 中声明的键）…`dsh-resource://file/session/<sessionId>/<path>` 指定授权 Host 读取的 Session」；:27 说明 `fileAddressFor` 工作区内转相对、盘符冒号保留。包实现 `asar: …/dsh-util-workspace-path/lib/index.js:9` `const FILE_ADDRESS_PREFIX = "dsh-resource://file/"`。
- ⇒ 插件 `lib/client.js:296` `FILE_ADDRESS_PREFIX = "dsh-resource://file/"`、:338 `DIFF_ADDRESS_PREFIX = "dsh-resource://diff-review/"` 的自造 type（`diff-review`）走的是「插件自声明资源协议键」这条路，与文档口径一致。
- tab 类型注册契约（`asar: …/dsh-client-ui-sidebar-right/lib/client.js:4905` `register(definition)`）：接受 `{ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted? }`；band 语义见同函数注释「An `extension` may register a kind a `builtin` already holds and takes it over until it unregisters」。插件 `lib/client.js:3030` 传 `{ id: DIFF_TAB_ID, kind: DIFF_TAB_KIND, patterns: [DIFF_ADDRESS_PREFIX + "**"], priority: "extension", canOpen, title }` —— **契约一致**，且 `priority: "extension"` 仍是合法取值。
- `ctx.inject([...], cb)` 在被注入服务迟到时的用法：`asar: dsh/node_modules/@deepseek-ai/cordis/lib/index.js:1672` `inject(inject, callback) { return this.plugin({ inject, apply: callback, name: callback.name }); }` —— 插件 `lib/client.js:3024` 的写法**合法**（并有 `typeof ctx.inject === "function"` 守卫 + 直接 `get` 兜底）。

---

## 5. `package.json` 的 `dsh.client.inject` 5 个包

插件声明（`package.json:18-23`）：
`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-sidebar`、`@deepseek-ai/dsh-client-ui-sidebar-right`

实测（读 asar 内各包 `package.json`）：

| 包 | 0.2.2-rc.1 是否存在 | 版本 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-conversation` | ✅ | 0.2.2-rc.1 |
| `@deepseek-ai/dsh-client-ui-settings` | ✅ | 0.2.2-rc.1 |
| `@deepseek-ai/dsh-client-ui-sidebar` | ✅ | 0.2.2-rc.1 |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | ✅ | 0.2.2-rc.1 |
| **`@deepseek-ai/dsh-client-runtime`** | ❌ **查不到** | — |

**「查不到」项排查范围**（逐条说明查了哪里）：

1. `asar` 全量文件表按目录项搜包目录 `dsh/node_modules/@deepseek-ai/dsh-client-runtime`：**0 命中**。
2. `asar` 全量 19,119 个文件按内容搜字面量 `dsh-client-runtime`：**0 命中**（含 README、类型声明、boot manifest、任何 JS）。
3. 作为对照，npm 全局 0.2.1-rc.2 安装树（`D:/scoop/persist/nvm/nodepath/node_global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）按内容搜 `dsh-client-runtime`：**0 命中**。⇒ **这个包名在 0.2.1 也不存在**，属于插件 `package.json` 里的历史遗留脏数据，不是 0.2.2-rc.1 的回归。

**这个不存在的包会不会导致拒载？—— 不会（确定兼容）**：

- 宿主侧只校验类型：`asar: dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:88-103` `parseDshClient` → `optionalStringArray(pkgName, "dsh.client.inject", decl.inject)` 仅要求 `string[]`；:88-96 把 `inject` 原样带进 graph row 字段。
- 浏览器侧解析 inject 时**取不到就跳过**：`asar: dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:787-792`

```js
for (const packageName of row.inject) {
    const dependency = this.graphRows.get(packageName);
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);
}
```

⇒ 未命中的 inject 项 = **没有排序约束**，既不报错也不拒载（`:949-951` 的 `prune` 里 `...row?.inject ?? []` 同样安全）。
- 同理 `platform: "web"` 仍是合法值：`asar: dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:790` `if (decl === void 0 || decl.platform !== "web") return null;`（非 web 才不发布）。

**建议（非阻塞）**：把 `@deepseek-ai/dsh-client-runtime` 从 `dsh.client.inject` 删掉——它不提供任何排序价值，且每次读 `package.json` 都要对着一个必然 miss 的包名。**但删它不会改变任何运行行为**，属于清理项而非修复项。

---

## 6. 装载器对 `engines` / `peerDependencies` / `dsh.compatibility` 的要求

插件 `package.json` 现状：**既无 `engines`，也无 `peerDependencies`，也无 `dsh.compatibility`**（对本仓库 `package.json` 整体 grep，三个键 0 命中）。

判定逻辑（`asar: dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`）：

- :1097 `function unmetRequirements(fields, runtimeVersion)` —— 先看 `fields.engines?.dsh`：有则**只按它判定**（忽略 peerDependencies）；否则遍历 `fields.peerDependencies` 里所有 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 项，用 `semver.satisfies(version, range, { includePrerelease: true })` 比对。
- :1129 `function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion())` → :1132 调 `unmetRequirements`，**无要求时返回 `undefined`**。
- :1159 `const PROFILE_COMPATIBILITY_FILENAME = "compatibility.json"` —— 精确版本豁免存放在 profile 目录（不是插件 `package.json`），:1806 / :3113 两处消费。

强制点（不兼容会怎样）：

- **插件级**：`preflight`（`appboot.js:3099-3140` 区段）对每条 loader row 求 `evaluatePluginCompatibility(...)`，命中则 `row.disabled = true` 并向 stderr 打 `disabling profile plugin …`（即「插件被静默禁用」而非崩溃）。
- **bundle 级**：`loadProfileDirectory`（`appboot.js:1795-1820`）对 bundle 也求一次，不兼容直接 `throw` → 记入 `skippedBundles`（`reportSkippedBundles` 汇总上报）。
- **安装时**：`dsh/lib/plugin-*.js` 的 `allow-version` 子命令负责写豁免；插件管理（`pm.js`）在安装阶段命中不兼容抛 `ManagementFailure("incompatible-version")`。
- **豁免**：`dsh plugin allow-version <pkg@ver> --dsh-version <exact> --accept-risk`。

⇒ **本插件不声明任何版本约束 → `unmetRequirements` 返回空 → `evaluatePluginCompatibility` 返回 `undefined` → 既不告警也不拒载**（确定兼容）。反过来说：插件目前对 DSH 版本**没有任何护栏**，任何破坏性升级都会以运行时错误而非装载错误的形式暴露——这是「故意不拦」还是「应该补 `engines.dsh`」，属于产品决策，本次取证不做判断。

### 6.1 顺带核对：`dsh.bundle.patch` 仍被支持

`asar: dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1311-1341`：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`（单文件或有序列表）仍是合法形态；:1336 `const declared = typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch;`。patch 的 `insert` 操作见 :497-527（`if (patch.insert) { … clone = structuredClone(insert) … }`，且「Runtime changes are routed back to an inserted entry by its id, so every insert needs one」）。

插件 `cordis.patch.yml` 只有一条：

```yaml
- insert:
    - id: diff-review
      name: 'dsh-change-review-live'
```

带 `id`、用 `insert` —— **符合要求**。

---

## 7. 插件自身锚点（供交叉核对）

- `lib/index.js:39` `const inject = ['webServer', 'agents']` —— 两个服务在 asar 中均存在（`webServer` 见 §1.4；`agents` 见 §1.5）。
- `lib/index.js:253` `const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])` —— 见 §3。
- `lib/index.js:890` `ctx.effect(() => () => { … })`（退出 flush）；:1700+ 13 处 `ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/diff-review/…', handler }))`。
- `lib/index.js:922` / :1091 `ctx.agents.store`；:919 `ctx.agents.get(rootId)`。
- `lib/index.js:1210` / :1232 / :1312 三个 `ctx.on` —— 见 §1.2。
- `lib/index.js:1255` 失败判据、:1282-1285 result `value`/`before`/`after` 取值 —— 见 §2.3/2.4。
- `lib/client.js:2604` `const inject = ["slots", "sessions", "theme", "workspaces"]` —— 四个客户端服务在 asar 中：`sessions`（`dsh-api-session-controller/lib/client.js:3856` `rootCtx.reflect.provide("sessions", this, void 0)`）、`theme`（`dsh-client-ui-theme/lib/client.js:2318` `ctx.provide("theme", theme)`）、`workspaces`（客户端 API 目录 `ccr.js:1771` `key: "workspaces"`）、`slots`（`dsh-cordis-client-runner/lib/client.js:1518` `key: "slots"`）—— 均在。
- `lib/client.js:296` / :338 / :330 / :404 / :418 —— 资源地址与 `openResource`，见 §4.5。
- `lib/client.js:2982` / :2985 / :2988 / :2991 / :3029 / :3036 —— 席位注册，见 §4.1/4.3/4.4。

---

## 8. 未覆盖 / 未验证项（诚实边界）

1. **未做运行期实测**：本次只做静态取证（声明 + 实现 + 派发路径），没有在 0.2.2-rc.1 上真正加载插件跑一轮会话。`exec.agent.session.header.cwd`、`ctx.agents.get(id).session` 已按实现链路证明存在，但**没有观测到实际取值**。
2. **`agents.store` 的 `entry.owner` 语义**只核对了类型与写入（`AgentRegistry.enter`），未验证 `resolveRootId` 在子代理场景下沿 owner 链聚合的行为是否与当前 0.2.1 一致。
3. **`dsh.compatibility` 字段**：本插件未声明；宿主对「插件 package.json 里是否存在该键」的处理未逐字确认（只确认了 `engines.dsh` 与 `peerDependencies` 两条判定路径 + profile 级 `compatibility.json` 豁免机制）。若未来要加约束，按 `engines.dsh` 写最稳妥（:1097 起有独立分支）。
4. **`resource 协议 diff-review type`**：确认了「插件可自声明资源协议键」的文档口径与 `dsh-resource://` 前缀实现，但**没有定位到 `ResourceProtocolMap` 的具体注册 API**（插件实际未用该 API，只用地址字符串 + 自定义 tab type 的 `patterns` 匹配，所以不影响结论）。

---

## 9. 结论汇总

**确定兼容（可直接运行）**：
1. Host 三个事件 `tools/pre-execute` / `tools/result` / `session/event` 仍在，参数形状一致，waterfall/emit 语义一致。
2. `ctx.effect`、`webServer.register({ kind:'exact', path, handler })`、`agents` / `agents.store` 全在。
3. 工具名 `write` / `edit` / `pwsh` / `bash` / `run_code` 五个全保留。
4. 客户端三个主用席位 + 三个附加席位全在，`key`/`id`/`order`/`inject` 语义与官方样例一致；`useTabInfo()` 的 `tab.contentId`/`tab.visible`/`tab.signal` 保留。
5. `openResource(address, options?)` 单参兼容；`dsh-resource://file/session/<sid>/<path>` 语法未变；`sidebarRightTabs.register` 的 `priority: "extension"` 仍合法。
6. 无 `engines`/`peerDependencies`/`dsh.compatibility` ⇒ 不告警、不拒载。

**有变化（但插件已兼容）**：
- 载荷字段正式名是 `exec.name` + `exec.arguments`（**无 `exec.tool` / `exec.input`**）；插件靠既有别名兜底正常工作。

**查不到**：
- `@deepseek-ai/dsh-client-runtime`：asar 全量 0 命中（目录项 + 内容）、0.2.1 全局树同样 0 命中。**不是回归**，是插件清单里的历史遗留项；装载器对未命中 inject 静默跳过，**不影响运行**。

---

*取证人：dsh-probe｜只读，未改动任何代码｜时间 2026-11-06*

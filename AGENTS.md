# dsh-change-review-live（DSH「实时审查」插件）

> 本仓库的 agent 事实清单：只写验证过的、仓库特有的内容；发现新事实就地更新（见 ## Maintenance）。

## Project

- **DSH（DeepSeek Harness）插件**，中文名「实时审查」：追踪会话内的 `write`/`edit` 工具调用与 shell 直写，按会话展示行级 diff、所属轮次与撤回。
- **fork 自 [cirelir/dsh-change-review](https://github.com/cirelir/dsh-change-review)**：两个 README 顶部都用 GitHub alert 块标明；`LICENSE` 的 `Copyright (c) 2026 cirelir` 原样保留，别改。
- GitHub 仓库已更名为 `sujingkpo/dsh-change-review-live`（remote 随之更新），**本地目录名仍是 `D:\work\github\dsh-change-review`**——桌面 profile 的 `link:` 依赖指向该路径，别改目录名。
- 一个包承载两半，**无构建步骤**：
  - Host：`lib/index.js`（~1814 行 / 86 KB，`name = 'diff-review'`、`inject = ['webServer', 'agents']`、`export { apply }`）——记录改动 + 注册 HTTP 路由，也是 `package.json` 的 `main`。
  - 浏览器：`lib/client.js`（~1928 行 / 120 KB，`window.__ModuleLoader__.load({ id: "dsh-change-review-live" })`）——React UI bundle，由 `exports["./client"]` / `dsh.client` 直接指向。
  - `cordis.patch.yml` 只做一件事：向 bundle `insert` `id: diff-review` / `name: dsh-change-review-live`。
- `package.json` 还声明 `dsh.bundle.patch`、`dsh.client.platform = "web"`、`dsh.client.inject`（5 个官方客户端包）、`files: ["lib", "cordis.patch.yml"]`；版本 `0.1.2`；**未发 npm、零依赖**。
- **更名范围（2026-09-14）**：对外标识全改（package name、patch、bundle id、侧栏 tab 类型 id）；**内部标识一律保留**——HTTP 路由 `/diff-review/*`、状态目录 `$DSH_HOME/diff-review/`、localStorage `dsh.diff-review.colors`、Host 插件名 `diff-review`、CSS 前缀 `drv-` / `dsdrv-`，已存记录与自定义颜色不受影响。
- 其它文件：`README.md`（英文）与 `README.zh.md`（中文）内容平行，改一个记得改另一个；`assets/screenshots/*.png` + 根 `screenshots.json`（市场截图）；`.handoff/`（发版说明、商店收录交接）；`live-test.md`（手工验证用文本文件，已入库）。仓库**没有 `.gitignore`**，临时验证文件会直接显示为未跟踪，用完删掉。

## Commands

- 语法检查（唯一的自动化门）：`node --check lib/index.js`、`node --check lib/client.js`。本机 node v24.19.0，路径 `D:\scoop\apps\nvm\current\nodejs\nodejs\node.exe`（注意双层 `nodejs` 目录；PATH 里也有 `node`）。
- **没有 package.json scripts、没有测试框架、没有 CI、没有 lint/typecheck/format 配置**——不要找 `npm test`。
- Host 离线验证（本仓库的标准做法）：`import` `lib/index.js`（导出 `apply`、`cap`、`diffLines`、`diffLinesChunked`、`diffHunks`、`buildSnapshotHunks`、`merge3`、`loadSessionFile`、`persistSession`、`serializeSessionFiles`、`migrateLegacyState`、`splitLines`、`name`、`inject`——后两个函数是 2026-09-18 为直接单测截断/分块行为而导出的：`import { buildSnapshotHunks } from './lib/index.js'` 就能拿合成内容断言 `truncated` 与行数）→ 用假 ctx（`on` / `effect` / `webServer.register` / `agents.store`）调 `apply` → 触发 `tools/result` → 直接调 `/diff-review/summary|turn|ui-prefs` 的 handler 断言载荷。**把 `DSH_HOME` 指向一次性临时目录**（见 Pitfalls 事故条）。
- 客户端验证：按行号从 `lib/client.js` 提取真实代码段，配假 React 钩子跑 `new Function`——**functional updater 返回同一引用即视为 React bail out**，这是判断「有没有多余重渲染」的判据。
- 视觉改版先做预览页：仓库根写一个单文件静态页（如 `preview-diff-pane.html`，CSS 与词级 diff 算法从 lib/client.js 抄同源），带 `#mode=…&palette=…&layout=side` 哈希状态（点控件写回地址栏，便于分享某个组合），用户确认后再落 `lib/client.js`，**用完删掉**（仓库无 .gitignore，会挂在未跟踪列表里）。
- 假 DOM 自测预览页：把页面的 `<script>` 抠出来，前面接一个 stub（`documentElement.getAttribute` 要按真实语义剥掉 `data-` 前缀、`querySelectorAll` 返回带 `forEach` 的空数组、`getElementById` 给 `innerHTML` / `style.setProperty` 桩），后面接断言，`node` 直接跑——不启浏览器就能压出作用域/字段错误。
- 客户端 bundle 的真实代码段验证（2026-09-18 用过，能压出运行时错）：用 `window.__ModuleLoader__.load` 捕获 `factory` → `factory(fakeRequire)`（`require("react")` 给假 React 桩，**`createElement` 必须把第 3+ 个参数收成 `children`**，否则走不出元素树）→ `mod.apply(fakeCtx)`：**`ctx.effect` 要真的执行回调**（`slots.register` 全在 effect 里，空实现会一个席位都注册不到，报「未注册 sidebar.right.pane.tab」这种假故障）→ 拿 `ctx.slots.register` 捕获到的组件直接调用渲染，再遍历元素树断言（函数组件不会被假 React 渲染，按 `props.name` 计数后手动调一次即可）。**临时脚本必须命名 `*.cjs`**：`package.json` 有 `"type": "module"`，`.js` 会被当 ESM，`require is not defined`。
- **headless Chrome 在 DSH 文件沙箱下必失败**（`FATAL:mojo\public\cpp\platform\platform_channel.cc:108`，命名管道受限），截图与打开浏览器都要单次 `danger-full-access`：
  `& "D:\scoop\apps\googlechrome\current\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=1680,1150 --user-data-dir="$env:TEMP\pv-chrome" --screenshot=out.png "file:///…/preview-diff-pane.html#mode=dark&palette=tuned&layout=single&sample=real"`
  再用 `read_image` 看回截图——这一步能抓出面板头按钮竖排、sticky 跳转导航不吸附这类只在真实布局里暴露的问题。**页面里有 `setTimeout` / IntersectionObserver 的话必须加 `--virtual-time-budget=2500`**，否则截图在定时器之前就拍了（自检输出会是空的）。
- `lib/client.js` ~120 KB，读文件工具单次返回有上限（`limit: 2000` 实测只回 974 行）：按目标行号分块读，别指望一次拿全量。该上限按**字符**算，与文件类型无关——32 KB / 499 行的 `preview-diff-pane.html` 同样会被截断（症状是拼出来的 JS 报 `SyntaxError: Unexpected end of input`，而文件本身没问题）：`offset` 递增、每次 `limit: 120` 分块读。
- 生效范围：Host 改动需**重启 DSH Desktop**；客户端 bundle 改动**刷新页面**即可。仓库本身就是安装件（profile 里是 symlink），不用重装。**怎么确认 Host 到底生效没有**：`Get-Process | Where-Object { $_.ProcessName -eq 'DSH Desktop' } | Select-Object StartTime` 与该文件的 `LastWriteTime` 一比——进程启动时间早于改动时间就是「还没生效」（2026-09-18 踩过：用户只刷新页面，Host 仍是 16:50 那份，所有 Host 侧修复看起来都「没修好」）。
- 沙箱限制（实测，2026-09-16/17）：
  - `git clone/ls-remote/push` 在受限沙箱必失败（SSH：`couldn't create signal pipe, Win32 error 5`；HTTPS：`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`）→ 单次提权 `danger-full-access`，或在沙箱外终端推送。只读 GitHub 查询可用：`curl.exe -x http://10.0.8.34:10810 https://api.github.com/...`。
  - workspace-write 下 `execFileSync('git', …, { stdio: ['ignore','pipe','ignore'] })` 报 `spawnSync git EPERM`（命名管道受限）→ 沙箱内离线验证覆盖不到 git 快照分支，只能验目录遍历兜底分支；宿主进程本身不受该沙箱约束。

## Architecture

### Host（`lib/index.js`）

- **记录入口**：`ctx.on('tools/result')` 记 `write`/`edit` 的成功结果；`pwsh`/`bash`/`run_code` 另走「命令前后文件快照做差」（`tools/pre-execute` + `tools/result`）补 `write` op。子代理沿 owner 链聚合到根会话（`resolveRootId`）。
- **shell 快照三层**：① `git status --porcelain -z --untracked-files=all`（仓库内全量发现）；② 非 git 退化为有界目录遍历（`SNAP_SKIP_DIRS` 跳过 .git/node_modules/dist 等，`SNAP_MAX_FILES = 4000`，深度 ≤ 6）；③ 本会话**已记录过**的文件额外逐个 stat（覆盖 `$DSH_HOME`、别的仓库等仓库外路径）。`before` 取值顺序：记录里上一份 `after` → `git show HEAD:<rel>` → `null`（未跟踪，按新增）；`after` 与最后一份记录内容相同则跳过（避免与 `write`/`edit`、含 `run_code` 内层调用重复记）。**删除不补 op**，交给 `statusOf` 显示删除态。基线按 `exec.callId` 关联，`SNAP_BASELINE_TTL = 5min` 过期清理，单命令最多补 `SNAP_MAX_CHANGES = 50` 个文件。
- **状态**：`$DSH_HOME/diff-review/<sessionId>.json`（每会话一文件，按需懒加载、变更去抖保存 + 退出时同步 flush），UI 偏好 `$DSH_HOME/diff-review/ui/<sessionId>.json`（`panelH` 限幅 96–4000 与 `collapsed` 两个字段独立更新、互不覆盖）；`DSH_HOME` 未设置/空白时回退 `~/.dsh`。状态根恒为 `$DSH_HOME/diff-review`，**不做任何跨根搬迁**（该功能 2026-09-17 整体删除）；旧版单一大文件 `diff-review-state.json` 的拆分迁移保留。
- **轮次**：`currentTurnOf(rootId)` 给 `op.turn` 打标（扫描最后一个未结束的 `turn/start`）；修复前落盘的旧记录（`turn=0`）由 `opTurn` 按 `turn/start` 的时间戳反推回填。`summary.currentTurn` = 最近**开始**的轮次（`turnCursor.lastStarted`，`turn/end` 后不清零），`latestTurn` = 最近**有记录**的轮次。**每轮开始宿主广播一次**：`ctx.on('session/event')` 挑 `turn/start` → `broadcast(resolveRootId(session.id))`（事件先入日志再派发，广播时 summary 已能看到该 turn/start）。
- **文件状态**：`statusOf(rec)` —— `added` = 首个 op 的 `before === null`；`deleted` = **绝对路径当前在磁盘上不存在**（`existsSync`，实时判定，不解析删除命令）；相对路径且记录无 `cwd` 时不判删除（避免误报）。`summary`/`turn`/`file` 三个载荷的文件项都带 `status`。
- **记录键归一**：`files` Map 的键 = `absPathOf(cwd, file_path)`；写入时 `findLegacyKeyOf()` 按绝对路径认领早先的旧键（相对/绝对、Windows 大小写差异）并迁移；`file`/`against`/`revert` 取记录统一走 `findRecord()`（精确 → 大小写不敏感 → 绝对路径归一）。
- **HTTP 路由**（`inject: ['webServer','agents']`）：`events`(SSE) `summary` `file` `turn` `against` `revert` `clear` `ui-prefs` `editors` `open-with-editor` `editor-icon/:id` `open` `reveal`。**当前有客户端调用方的只有** `events` `summary` `file` `turn` `against` `revert` `ui-prefs` `open`；`clear`/`reveal`/`editors`/`open-with-editor`/`editor-icon` 已无 UI 入口（`ReviewView`/`FileList`/`TurnReview`/`EditorPicker` 不再挂载）——**别照这些路由反推功能存在**。路由带鉴权，`curl` 直连只会拿到 `forbidden`（9 字节），验证请读状态文件或走离线 handler。
- **「打开文件」两级**：**优先在 DSH 右侧 Sidebar 内预览**——`ctx.get("sidebarRight").openResource("dsh-resource://file/session/<sessionId>/<path>")`（地址构造内联自 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor`：工作区内转相对、工作区外保留绝对、盘符冒号不编码）；服务缺失或地址被拒时**降级**为宿主 `POST /diff-review/open` → `spawn` 系统打开器（win32 `cmd /c start ""` + `windowsVerbatimArguments`、darwin `open`、其它 `xdg-open`）。
- **二进制守卫（2026-09-18 第七轮）**：`looksBinaryText()` —— 前 8KB 里出现 NUL 字节，或不可打印字符 + UTF-8 替换符 U+FFFD 占比 > 10%，就认为不是文本；快照、入参片段（old/newString）、整文件内容**任一侧命中都不做文本 diff**，只回一行 `（二进制内容，已跳过文本对比）`（`BINARY_NOTICE`）。起因：会话把 PixPin 截图 PNG 当文本记下来了（实测一张 44 万字符、单行 15 万字符），旧 Host 在 1500 行处截断 → 面板里冒出一堆「已截断」卡片；不截断更糟（换行模式折成两万行、不折行滚动宽度上百万像素）。**守卫只在渲染侧**：记录与撤回不受影响，二进制文件的改动仍可撤回。
- **上限常量**：`SNAPSHOT_MAX_CHARS = 5000000`（超此大小不存快照 → 该 op 不可撤回、diff 退化为片段）、`FRAG_MAX_CHARS = 350000`、`MAX_OPS = 100`/文件、`MAX_MERGE_LINES = 2000`（三路合并）。**行数上限（2026-09-18 第五轮，已从「硬截断」改成「分块」）**：`MAX_DIFF_LINES = 3000`（整段 LCS 的预算，`diffLines` 的内存是 (n+1)×(m+1)×4B，3000² ≈ 36MB）、`DIFF_CHUNK_LINES = 1000`（超预算时按块做 LCS，单块 ≈ 4MB，`diffLinesChunked`）、`MAX_WHOLE_LINES = 20000`（**硬上限**：单侧为空时是展示上限、双侧时是分块总量上限，只有超过它才真的截断并让段头显示「（内容过长已截断）」）。**超预算≠丢内容**：块边界无法跨块配对，那里退化为「整块删 + 整块增」。实测 12000×12000 全改 → 24000 行完整返回、约 190ms（旧实现在 3000 行处截断）。

### 侧栏「审查 diff」tab（本插件自注册）

- **类型**：`id: dsh-change-review-live:diff-review`、`kind: "diff-review"`、`patterns: ["dsh-resource://diff-review/**"]`、`priority: "extension"`、外加 `canOpen` / `title` 回调；地址 = `dsh-resource://diff-review/session/<sid>/<整段编码的原始路径>`（**整条路径作为一段 encodeURIComponent，反斜杠 → %5C**；宿主 `files.get(path)` 是精确匹配）。
- **正文**注册到 `sidebar.right.pane.tab`，**`key` 必须是类型 `id`**；组件从框架注入的 `useTabInfo()` 读 `tab.contentId`（= 整条地址，也是去重键）、`tab.visible`、`tab.signal`。`DiffPane` 走本插件 HTTP 路由取数（本协议没有 `ctx.resources` provider，`useResource` 恒为 none）。
- **刷新语义**：ops（会话记录）模式自动刷新（SSE → `reviewTick+1` → 重拉 `/diff-review/file`，另有 **15 s** 兜底轮询 `lib/client.js:871`）；`initial`/`git` 两种对比**刻意不自动刷新**（避免每次改动都跑 `git show`），靠第二行「刷新」按钮；一律以 `tab.visible` 为闸门（收起侧栏/后台 tab 不空转，重新可见立刻刷一次）。
- **chip 图标**：宿主 tab 定义**没有 icon 字段**，要在标题上放图标必须再注册 `sidebar.right.pane.tab.title` 席位（**`key` 同样是类型 `id`**，`{ name, key }` 即可）；组件返回「自绘 diff 图标 + 标题文字」（左半 = 改动前取 `turnDel` 红、右半 = 改动后取 `turnAdd` 绿，随明暗外观与自定义色板变化）。该席位的 `hookContext.title` 只是布尔标志，**不是标题文本**——标题文本仍从 `tab.contentId` 现算。改成自定义元素后宿主对 chip 文本的省略不再生效，故自带 `.dsdrv-tablabel` 单行省略。

- **视觉定稿（2026-09-18 第二轮反馈）**：默认色板换成 One Dark Pro 系——行文字恢复彩色（增行绿 / 删行红）、行底色低饱和同色系、`ctxBg` 全透明（深色下不再出现一坨 `#161b22`）；词级高亮 `--drv-mark-c` 降到 **18%**（35% 在暗色下太吵）。**色弱强化三件套**（用户明确要求「照顾色弱」）：左侧 3px 色条 + 增行加白 5% / 删行压黑 20%（浅色 30% / 10%）+ ± 加粗着色；明度叠加层分浅深两套，靠 pane 根节点上的 `dsdrv-scheme-dark|light`（取 `store.scheme`）切换。排版：正文 13px / 行距 1.65 / 折行悬挂缩进 2ch，行号列 34+34+16px、字号 12px、底色 10%、分隔线 30%。
- **图标**：`ICON_SHAPES` + `Icon` 组件（自绘 16×16 线条，`stroke: currentColor`，零依赖）——面板头的复制/打开/刷新/折行、三个对比模式、撤回全部，以及段头的撤回，全部只画图标，文字一律进 `title`（对比模式的名字也从「会话记录 / 初始版本 / Git 版本」缩成 title 里的完整解释）。
- **面板分层（2026-09-18 第三轮修正）**：`.dsdrv-pane` 是 `display:flex; flex-direction:column; height:100%; overflow:hidden; padding:0 12px` 的**外框**；文件头与工具行 `.dsdrv-pane-head` 不再是 sticky、**留在滚动容器之外**；正文（含「省略 N 行」、对比说明、跳转导航）统一装进 `.dsdrv-pane-body`（`flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; **padding-right:6px**; padding-bottom:24px`），它是**唯一滚动容器**。**滚动容器都要留右侧留白**（`.dsdrv-pane-body` 6px、`.dsdrv-livepanel-list` 10px）：不然滚动条会紧贴内容右边缘，观感很挤（用户专门提过）。推论：段头 sticky 改成 `top:0`；`--drv-head-h` 与写入它的那个 ResizeObserver 与 `headRef` **已整体删除**（留着就是死代码）。用户原话是「横向滚动加错地方了」——早期实现给 `.dsdrv-pane` 加 `overflow-x` 再给头加 `left:0` 打补丁，属于加错层。
- **折行开关**：localStorage `dsh.diff-review.wrap`（默认折行，只有 `"0"` 表示不折行），面板根节点加 `dsdrv-nowrap` 走 `white-space:pre`；**不写 Host**（`ui-prefs` 仍然只有 `panelH` / `collapsed`）。**横滚落在哪一层（2026-09-18 第六轮定稿）**：横滚**下沉到每张段卡片内部**——`.dsdrv-nowrap .drv-section-body { overflow-x:auto; overflow-y:hidden }`（`overflow-y` 只能是 hidden：横滚 + 纵 visible 不合法，会被算成 auto 而在卡片里冒出内层纵向滚动条；卡片高度本来就是内容高度，不会裁东西），同时 `.dsdrv-pane-body { overflow-y:auto; overflow-x:hidden }`。效果：外层（面板正文/侧栏/宿主）**永不出现横向滚动条**，滚动条就贴在出问题的那张卡片里，段头也不跟着动。另需 `.dsdrv-nowrap .drv-line { width:max-content; min-width:100% }`，否则滚到右边行背景只铺到可见宽度。实测：body `scrollWidth==clientWidth`（外层横滚=false）、card `scrollWidth=1381 > clientWidth=473`（卡片内横滚=true）。**不要**把横滚加在 `.dsdrv-pane` 上（第二轮加错层的教训），也不要指望 `.drv-section-body` 用 `overflow:visible`；用户原话是「滚动条应该是在打开的那个面板里」。
- **「没有差异」必须明确说（2026-09-18 第八轮）**：与基准版本对比（尤其 `mode=git`）而内容一致时，Host 的 `compactHunks` 会把「全文都是无变化上下文」折成 `hunks: []`（没有任何变更 → keep 全 false → 输出空数组），客户端照旧渲染就是一张**空卡片**。现在 `totalHunks === 0` 时整块换成按模式区分的结论文案 `noDiffText`（Git HEAD / 会话最初 / 会话记录三套），并把 `data.baseLabel`（如「Git HEAD 版本 ←→ 工作区当前内容」）一起显示；单段 0 行时在段内显示 `（这一轮没有差异）`（`.drv-sec-nodiff`）。Git 模式再多给一行 `.drv-nodiff-hint`「内容可能已经提交（本次改动已进入 Git 提交记录）」——与 HEAD 一致最常见的原因就是已经提交了。用户原话：「如果 git 版本比对没有修改，则明确标识没有修改」＋「增加一句提示：内容或已经提交」。
- **超大段的渐进渲染（2026-09-18 第五轮）**：Host 不再截断后，万行级的段会原样返回，一次挂上万行 DOM 会卡住面板——`Section` 里加了 `SECTION_PREVIEW_ROWS = 1500`：段内行数超过它就先只渲染前 1500 行，底下给一颗 `.drv-more-btn`「显示剩余 N 行」，点击后 `setShowAllRows(true)` 全量渲染。状态在组件内（切段/重挂载回到预览态），数据本身始终完整。切片点落在 del/add 配对中间时那一对退化为不成对显示（无词级高亮），可接受。
- **第四轮反馈修正（2026-09-18）**：① 段头问题文本改 `flex:0 1 auto; min-width:0`（**去掉 `max-width:38%`**）——占剩余空间、不够时自己省略，其余元素一律 `flex:none` 优先；**副作用是 `.drv-badge` 必须补 `flex:none; white-space:nowrap`**，否则被挤成「修/改」两行（mock 截图里抓到过）。② 折叠指示从 `▸/▾` 字符换成 `ICON_SHAPES.chevron`（12px SVG），展开态用 `.drv-sec-chevron-open { transform:rotate(90deg) }` 旋转。③ 吸顶探测与 `.drv-sec-stuck` 见上一小节 ⑥。
- **色板迁移**：`KNOWN_DEFAULTS = [PREV_LIGHT, PREV_DARK, OLD_LIGHT, OLD_DARK]` 四份历史默认一起参与「从没改过颜色」判定（逐键归一化后整体比较）。**再改默认色板时，必须把当前这套也加进 `KNOWN_DEFAULTS`**，否则老存档会被当成用户自定义而留在旧色上。
- **第三轮反馈修正（2026-09-18）**：① 段头吸顶要**半透明 + `backdrop-filter:blur(6px)`**（`color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, transparent)`，hover 高亮用 `background-image` 叠加层）：纯 `rgba(128,128,128,0.1)` 会漏字，纯不透明又太死板——模糊掉下面的行、保留一点底色透出；② 段头问题文本 `max-width:38%`（`flex:1 1 auto` 会把徽标/元信息/撤回挤到边上），空白交给 `.drv-header-spacer`；③ 对比度再拉一档：增删底色 alpha 0.26 / 0.24（浅色 0.24 / 0.2）、删行压黑 0.28（浅色 0.14）、色条 `color-mix(… 85%)`、词级 22%；④ 「撤回全部」图标换成「竖条 + 双左箭头」，与段头的单撤销箭头明显区分；⑤ 上下文展开等级持久化到 localStorage `dsh.diff-review.ctx`（只认 `0 / 24 / 500` 三档），刷新后不再回到「全都省略」；⑥ 段头圆角（**第四轮定稿**）：未吸顶时卡片 12px、段头 11px 上圆角，**只有吸顶时才去顶部圆角**——纯 CSS 判断不了 sticky 是否吸住，所以在卡片最前面插一个 1px 的 `.drv-sec-sentinel`（`height:1px; margin-bottom:-1px`），由 DiffPane 的 IntersectionObserver（`root = .dsdrv-pane-body`）在哨兵滚出滚动区顶部时给卡片打 `.drv-sec-stuck`；判据是 `!isIntersecting && boundingClientRect.top <= rootBounds.top`，用来区分「已滚到上方（真吸住）」与「还在下方没进视野」。只切 class、不 setState（滚动时零重渲染）。

### 输入框上方审查列表（`LivePanel`）

- **席位**：`ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "diff-review-live", order: 20, inject: (sessionId) => ({ sessionId }) }, …))`，**只在 `apply` 里注册一次**（不存在按 store 更新重新注册 / 重挂载）。宽度照抄官方 `TodoPanel` 根节点公式（`--dsh-composer-side-clearance: 16px`、`--dsh-composer-dock-inset: 8px`），改宽度时两者要同步考虑。
- **数据链路**：`allList → scopeList`（范围筛选；`"none"` ⇒ 空数组）`→ baseList`（默认藏起删除态/工作区外）＋ `extraList`（降噪开关打开时从全量补该类文件）`→ visibleList`（按 path 去重 + 按时间倒序）。文件名标记色**只按 `latestList` 判定**（`isLatest`）；标题摘要用 `titleList = visibleList`。
- **筛选条**：范围是三态 `"latest" | "all" | "none"`，**点已选中的那枚即取消**（进入 `"none"`：两枚都不高亮、基础列表为空）；两个降噪开关（「已删除 N」「工作区外 N」，**都默认隐藏**）**刻意不受范围约束**——打开时把全量里该类文件追加进列表，任何轮次点开都必有结果（早期限制在范围内时出现「按钮可见、点了没反应」）。数量显示为「当前范围数量/会话总量」，`scope === "none"` 时只显示会话总量（否则出现「显示 0/3、点开却有 3 条」）。**「只查看删除 或 外部文件」的入口**就是：范围全取消 + 打开对应开关；两个都开 = 并集。`scopeTurn === 0`（旧记录无任何轮次信息）时范围恒按全量，否则面板会永远停在「加载当前轮次…」（`scopeTurn = currentTurn > 0 ? currentTurn : latestTurn`）。
- **行内提问只在「全部轮次」显示（2026-09-18 第十轮）**：行尾的 `.dsdrv-livepanel-rowq`（内容 = `qOf(f)` = `sections[0].question`，用标记色 `colors.qText`）在 `scope === "latest"` 时**不渲染**——当前轮次整份列表都属于同一个问题，逐行重复用户提问纯属噪声、还挤占文件名与增删统计的位置。摘要行里的提问**保留**（它是面板那一行的唯一问题来源）。用户原话：「审查列表, 当前轮次, 列表上不用显示用户信息了」。
- **摘要**：前缀 = 视图标签（「最近变动」/「全部轮次」，已打开的开关追加「已删除」/「工作区外」，混合如「最近变动 + 已删除 - …」；`"none"` 且无开关时前缀「未选择范围」但整段不渲染），正文 = 前 2 个文件的 basename（「 | 」连接，超长由 CSS 单行省略）+ 问题段（取列表顺序里第一个带 `sections[0].question` 的文件，即最近一次改动的问题；删除态/工作区外的文件同样可能带问题）。列表为空时 `titleList.length > 0` 为假、**整段 span 不渲染**。
- **空态提示** `emptyHint`：加载中（且范围为 latest）→「加载当前轮次…」；范围为 latest 且本轮无变更且未开降噪 →「本轮暂无变更」；`"none"` 且未开降噪 →「未选择范围…」；其余（有内容但全被降噪藏起）→「…被降噪开关藏起来了」。
- **刷新与去抖**：取数 effect 依赖 `[session, scopeTurn, tick]`；**只有作用域键 `session|scopeTurn` 变化才置空列表**（`lastScopeKeyRef` 记住上一次的键），同轮次内因新改动重取**不动**已有列表（旧实现每次进 effect 都 `setLatestFiles(null)`，展开的列表于是闪动）；模块级 `liveTurnCache`（键 = 同一作用域键，上限 `LIVE_TURN_CACHE_MAX = 8`，超出丢最早插入的）既是 `useState` 初值、又是换作用域时的回填（重挂载也能立刻出内容）；`turnSigOf()` 给文件列表算展示字段签名（path/status/lastTime/ops/added/removed/repoPath/turns/tools/outside/`sections[0].question`），与当前 state 相同就 `return cur` 让 React bail out。取数失败只解除加载态（`cur` 非空则保持不动）。
- **摘要侧另有 2.5 s 兜底轮询** `setInterval(refreshFromServer, 2500)`（`lib/client.js:1851`，仅当 `store.currentSession` 存在）——**纯删除**不产生 op、宿主不广播，就靠它上屏（最多 2.5 秒）。
- **展开态**：模块级 `livePanelCollapsed`（按会话记忆）＋ Host `ui-prefs.collapsed`，**只有用户点击会写**（`setCollapsed` 是唯一写入口，任何自动流程都不碰）——面板会在新轮次/会话被 React 重新挂载，组件内 `useState(true)` 会被重置成「自动折叠」。没有记忆的会话（含全新会话）默认折叠。

## Conventions

- 文件头必须有 `@description`/`@author`/`@date`；**不再追加 `@modify`**（堆积的 @modify 段已从两个 lib 文件整体清空，2026-09-17 用户决定——最长时注释 330+ 行，收益为负；变更史看 git）。
- 函数与复杂逻辑写中文注释；单行 `if` 也必须带大括号；不留空代码块。
- 换行符：`lib/*.js` 是 **CRLF 且 0 个裸 LF**（`lib/index.js` 1813 个 CRLF、末行无换行；`lib/client.js` 1927 个）；`AGENTS.md` 是 **LF**。改文件别把换行符统一掉。
- `lib/client.js` 是 bundle：内部用 **Tab 缩进**，`lib/index.js` 用 2 空格；编辑时保持原样。

## Pitfalls

- **`Session` 没有 `events` 属性**：`@deepseek-ai/dsh-session` 只暴露 `snapshotEvents()` / `ownEvents()`。旧写法 `session.events` 静默得到 `undefined`（被 `Array.isArray` 挡掉）→ `op.turn` 恒为 0、列表不显示轮次、每轮问题为空。
- **别猜客户端 service 方法**：`ctx.workspaces.openPath` 在桌面端不存在（全量客户端包 grep 0 命中），旧代码调用后静默 no-op、点击毫无反应。打开文件用 `ctx.get("sidebarRight").openResource()`；**未声明的服务必须走 `ctx.get`**——属性直读 `ctx.sidebarRightTabs` 会直接 throw。
- **`dsh-resource` 文件地址必须是 session 作用域**：pattern 是 `dsh-resource://file/**`，但 `hostFileOf()` 只接受 `file/session/<sessionId>/<path>`；`absolute` 作用域会 throw（"not a session file address"），地址无人认领时 `openResource` 同样 throw。
- **注册 `sidebarRightTabs` 必须等它到齐**：用 `ctx.inject(["sidebarRightTabs"], cb)`（服务出现/重现时会重跑），**别在 `apply` 里 `ctx.get` 一把**——席位声明可能早于服务出现，一次性读会永久注册不上；也不要把 `sidebarRightTabs` 写进插件级 `inject`（服务缺失会让整个插件挂起）。
- **删除只能靠磁盘判定**：插件不解析删除命令，`statusOf()` 以「文件当前是否存在」为准。推论：**新建后又删掉**的文件显示「删除」而不是「新增」；会话外被删的文件也显示「删除」（这是期望）；删除态默认不在列表里显示（会按时间倒序挤在最前，把真改动压下去）。
- **纯删除不广播**：宿主在 shell 快照里遇到文件消失时读不到内容会 `continue`，既不产生 op 也不 broadcast → 面板只能靠 2.5 s 兜底轮询上屏；想让删除「立刻」可见没有现成路径。
- **列表「没变化」判断必须带 `status`**：客户端 `refreshFromServer()` 用 `summarySigOf()`（path/status/lastTime/ops/added/removed/turns/repoPath）比较；旧实现只比 path/lastTime/ops——文件被删后这三个字段都不变，于是既不拉详情也不刷新列表。**新增展示字段时要同步进签名**（客户端另有 `turnSigOf()`）。
- **折叠段「点两次才展开」（2026-09-18 用户反馈并修复）**：`collapsedMap` 是稀疏表，只记录「用户点过的段落」，默认折叠的段落不在里面——旧 `toggleSection` 直接 `!m[key]` 取反时 `!undefined === true`，第一次点击反而把「折叠」写了进去。修法：抽出 `isCollapsed(sec, i)` 与传给 `Section` 的 `collapsed` 共用同一份计算，toggle 接收「当前生效值」再取反。**凡是「稀疏 map + 取反」的开关都有这个坑**。
- **Windows 路径**：Host 文件项的 `name` 是 `String(rec.path).split('/').pop()`，反斜杠路径下等于整条路径；要展示路径请用 `repoPath`（仓库相对）/ `absPath`（绝对）。
- **shell 直写的改动曾完全不被记录**（2026-09-17 事故，当天修复）：现场是会话为绕开 WebStorm 文件占用而走 `_patch*.json` + `_apply*.ps1`，8 处真改动一条都没进记录，列表里只剩临时脚手架。现由快照差兜住，**剩余边界**：① 既不在 git 仓库、又从未被 `write`/`edit` 记录过、又在会话 cwd 之外的文件抓不到；② git 不可用时退化为目录遍历（有 `SNAP_SKIP_DIRS` 与 `SNAP_MAX_FILES` 上限）；③ 单命令超过 `SNAP_MAX_CHANGES = 50` 只补前 50 个；④ 单文件超过 `SNAPSHOT_MAX_CHARS` 跳过。
- **离线假 ctx 验证曾删掉真实记录**（2026-09-17 事故）：`apply()` 里旧 `migrateHomeMove()` 用 `renameSync` 把 `~/.dsh/diff-review` 整个搬进 `$DSH_HOME/diff-review`；把 `DSH_HOME` 指到 `%TEMP%\drv-*` 跑验证后收尾 `Remove-Item -Recurse`，50 个会话的记录永久丢失（`unlinkSync`/`renameSync` 不进回收站）。功能已整体删除，但**教训长期有效：`DSH_HOME` 只指向一次性目录，永远别把递归删除指向可能是数据根的路径**。

## Maintenance

- 桌面 profile：`C:\Users\czy\.dsh\profiles\desktop`；当前激活 profile 见 `%APPDATA%\DSH Desktop\profile-selection\state.json`（`active: desktop`）。
- 校验「安装件 = 仓库」：profile `package.json` 的依赖键 `dsh-change-review-live` → `link:D:/work/github/dsh-change-review`，且 `node_modules/dsh-change-review-live` 是 `SymbolicLink` 指向本仓库——改仓库文件即改安装件，无需重装。
- 安装方式：README 只保留 `dsh plugin --profile web add github:sujingkpo/dsh-change-review-live`（桌面端把 `web` 换成 `desktop`）；**不要再往 README 加回「手动部署（cordis.patch.yml 片段）」**（已按用户要求删除）。
- 发版：现有 tag `v0.1.0` / `v0.1.1` / `v0.1.2`（分支 `main`，remote 走 SSH）；GitHub Release 页面未创建，发版文案在 `.handoff/release-v0.1.*.md`。
- 本文件是活文档：发现新的仓库命令、约定或坑，就地更新对应小节；保持精简，删掉过时条目。

### 发布 / 商店收录

- **商店 = [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 列表**（dsh-market 读同一份数据）：收录数据是 `data/plugins/<owner>__<repo>.yml`，一个插件一个文件；两个 README 由 `scripts/generate-readme.mjs` 生成，**禁止手工编辑**。
- 本插件条目 `data/plugins/sujingkpo__dsh-change-review-live.yml`（`category: ui`）；条目字段只允许 `url` / `name` / `category` / `description.en|zh` / `tarball`（多一个键就被打回，描述含 `: ` 必须加引号且单行）。fork `sujingkpo/awesome-dsh-plugin` 已存在（与上游同提交 `7a5da6a5`）；提 PR 的分支名 `add-dsh-change-review-live`，只该动 `data/plugins/`（+1/−0），一个 PR 最多 3 条。
- 根 `screenshots.json` 声明市场详情页截图（1–8 张相对路径，当前 2 张：`assets/screenshots/review-list.png`、`diff-pane.png`）；改截图推本仓库即可，不必再提 PR，**别往列表侧的 `data/screenshots.json` 加键**。
- 收录硬性要求（2026-09-16 核对）：`package.json` 必须声明 `dsh.bundle`（只有 `dsh.client` 不够，最常见退回原因）；仓库需加 `dsh-plugin` topic（截至核对时仍为空，待加）；未发 npm、不声明 `tarball` 都不影响收录（npm 只影响市场是否显示下载量）。
- 完整文案与命令见 `.handoff/商店收录-提交流程.md`。

# dsh-ops 集成与 DSH 版本核查 — 交接

> @description dsh-ops 0.5.0 安装/生效状态、DSH 版本取证、工具面 PUBLICATION_DENIED 缺陷与切 PTC 模式后的复测清单
> @author lead
> @date 2026-11-06

## 一、结论速览

| 项 | 状态 |
| --- | --- |
| DSH 当前版本 | **0.2.2-rc.1**（desktop 外壳 2.0.21-next） |
| dsh-ops 集成 | **已完成**：0.5.0 本地 tgz 安装，bundle 内、enabled、fiberPhase=active |
| 工具面 | **9 个可用**；**8 个报 `PUBLICATION_DENIED`**（stat / write_file / edit_file / remove / diff / read_table / read_docx / read_pdf）；`ops_result` 另报 `EXECUTOR_UNAVAILABLE`（符合预期）——共 18 个 |
| 阻断原因 | dsh-ops `registrar.js:124` 的「定义身份 / toolSet 快照」校验失配，疑似本会话 presentation 不是 PTC 造成 |
| 下一步 | **切到 PTC 模式后复测**（见第四节），PTC 路径对 file 类 API 跳过该身份校验 |

## 二、DSH 版本取证（原始证据）

- 安装目录 `E:\Program\DeepseekHarness\`，主程序 `DeepSeek Harness.exe`。
- `resources/app.asar` 头解析出的三个 package.json：
  - `/package.json` → `@deepseek-ai/dsh-desktop` **0.2.2-rc.1**
  - `/dsh/package.json` → `@deepseek-ai/dsh-desktop-runtime` **0.2.2-rc.1**
  - `/dsh/node_modules/@deepseek-ai/dsh/package.json` → `@deepseek-ai/dsh` **0.2.2-rc.1**
- exe VersionInfo：`ProductVersion 0.2.2.0` / `FileVersion 0.2.2-rc.1`；app.asar `LastWriteTime 2026-11-04 17:30:40`，213,202,918 字节。
- `resources/runtime/versions.json`：node **24.21.0**、pnpm **11.28.5**。
- `app-update.yml`：channel `nightly`，url `https://download.deepseek.com/dsh-desk/feeds/win-x64/`。
- `~/.dsh/electron-user-data/next-updates/state.json`：`notifiedVersion "2.0.21-next"`（外壳版本号，非 dsh 包版本）。
- 历史日志 `~/.dsh/logs/desktop-next.log` 最后一次 `run.start`（2026-11-05T03:27:08Z）记录 `{"version":"2.0.21-next","electron":"44.7.0","node":"v24.21.0","dsh":"0.2.1-rc.4"}` —— **旧版遗留，已被 0.2.2-rc.1 覆盖，勿当作现值**。
- 对照：npm 全局装的是 `@deepseek-ai/dsh@0.2.1-rc.2`；registry 上 latest/next 均 0.2.2-rc.1，alpha 为 0.2.2-alpha.3。桌面端跑的是 asar 内自带 runtime，与 npm 全局副本无关。
- 运行中进程：`DeepSeek Harness.exe` 启动于 2026/11/6 14:22:57（另有 12:08 一批）。

## 三、dsh-ops 集成现状

### 3.1 源码与安装

- 仓库 `D:\work\github\dsh-ops`：HEAD `1a9e0e2`（2026-11-06 11:03:43 +0800，`ci(release): keep the gate's platform skips meaningful`），`git describe = v0.5.0-1-g1a9e0e2`，package.json version **0.5.0**；仅一个未跟踪产物 `dsh-ops-0.5.0.tgz`（65,405,225 字节）。
- profile `C:\Users\czy\.dsh\profiles\desktop`：依赖写成 `"dsh-ops": "file:D:/work/github/dsh-ops/dsh-ops-0.5.0.tgz"`，`node_modules/dsh-ops` 是 **0.5.0 实目录**（非 symlink）。
- `dsh.profile.bundles` 含 `"dsh-ops"`；`desktopNextDeselectedBundles` 也含它（NEXT 轨道未选，当前 track 不使用）。
- `plugin_manager list_plugins` → `include:dsh-ops`，moduleName `dsh-ops`，`enabled: true`，`fiberPhase: "active"`（已加载生效）。
- `node bin/dsh-ops.mjs status --profile desktop` → `{"profile":"desktop","directory":"C:\\Users\\czy\\.dsh\\profiles\\desktop","dependency":"file:D:/work/github/dsh-ops/dsh-ops-0.5.0.tgz","enabled":true}`。
- `ladder --json` → worker `resolved=true`，`...\node_modules\dsh-ops\runtime\win32-x64\dsh-ops-worker.exe`（source "packaged runtime"）；bash `available`（bundled Niubash v1.5.0，`.../niubash/niu.exe`）；pwsh `available:false`（host 管理，需要 `dsh-ops upgrade-host-pwsh`）。
- `runtime/win32-x64/provenance.json`：version 0.5.0，target win32-x64，sha256 `3d2cfa90ce21a3a40fa9d73ab54968aaca2b7656f8690679a70e79f223b53e17`。

### 3.2 兼容性

- package.json engines：node `^22.19 || >=24`，dsh `>=0.2.2-rc.1 <0.2.3-0`；peer 依赖 `@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/dsh` 同区间 → **与当前 DSH 0.2.2-rc.1 严格匹配**。
- 仓库 CHANGELOG 0.5.0（2026-11-06，Stable）：0.5 系列只面向 DSH 0.2.2-rc.1+，是破坏性版本 —— 本次 0.5.0 就是为配 0.2.2-rc.1 而发。
- npm 上 `dsh-ops` latest 仍只有 0.4.4，**0.5.0 未发 npm**，所以只能走本地 tgz。

### 3.3 profile 补丁（`C:\Users\czy\.dsh\profiles\desktop\cordis.patch.yml`）

- `dsh-ops-mode-minimal/standard/cordis` 三行均 `disabled: true`（0.5.0-alpha3 起退休，config 不生效）。
- 合并行 `- id: dsh-ops / name: dsh-ops`：
  ```yaml
  global: {bash: true, hidePwsh: true, hideOfficialTools: true, dynamicTools: true}
  minimal/standard/ptc/cordis: 均 enabled: true、residentTools: true
  ptc 段另加 hidePwsh: true 与
  alwaysLoaded: [read_files, glob, grep, stat, write_file, edit_file]
  discovery: {enabled: true}
  download-guard / panel / tui: 关闭
  ```
- `agent-preset-registry`：`default: standard`，`selectedDefault: ptc`。

## 四、工具面实测与缺陷

### 4.1 冒烟结果

- **可用**：`ops_bash`、`ops_inspect_local_file`、`ops_read_files`、`ops_glob`、`ops_grep`、`ops_copy`、`ops_replace`、`ops_discover_tools`（共 8 个，读写与复制实测均正常，`metadata.preserved=true`）。
- **被拒**：`ops_stat`、`ops_write_file`、`ops_edit_file`、`ops_remove`、`ops_diff`、`ops_read_table`、`ops_read_docx`、`ops_read_pdf`，统一返回：
  ```
  rejected: PUBLICATION_DENIED
  [Notice: effectState=none; retry=never; .]
  Publication authorization is unavailable.
  ```
  `write_file` / `edit_file` 即使 `dryRun: true` 也被拒 ⇒ 拒绝发生在发布/授权层，不是 CAS 或参数问题。
- `ops_result` 单独一类：返回 `EXECUTOR_UNAVAILABLE`（"Session result storage is unavailable under current host authority."），与全局 AGENTS.md 记载的「danger-full-access 下宿主未提供 prepareResultStorage」一致，**这不是缺陷**。
- 用子代理（新 agent 作用域、新 toolSet）复测 `ops_stat` / `ops_write_file` → **同样被拒**，说明不是本会话单次快照陈旧，而是稳定复现的发布授权失配。

### 4.2 根因定位（安装件源码，`C:\Users\czy\.dsh\profiles\desktop\node_modules\dsh-ops\`）

- `lib/publication/registrar.js:3-4` 定义 `denied()` 的文案；触发点在同一个文件的 `execute` 包装里：
  ```js
  // registrar.js:124-126
  if (definition !== next || !exec.agent || !exec.toolSet
      || tools.executable(name, exec.agent, exec.toolSet) !== next) {
      return denied();
  }
  // registrar.js:127-129
  const matching = eligible(exec.agent);
  if (!matching.length || matching.some(grant => grant.dispatch !== matching[0].dispatch))
      return denied();
  ```
  即：调用时该 name 在当前 step 的 toolSet 里解析到的 executable **不再是注册时那个定义对象**（定义被轮换 / step 快照较旧），或者该 agent 的 grant 集合为空/不一致。
- 定义轮换的源头：`refresh(true)` 由 `lease.grant(...)` 触发（`registrar.js:203`），并且 `ctx.on('tools/change', () => refresh())`（`registrar.js:185`）；PTC 侧 `rotateFiles`（`lib/publication/ptc.js:93-109`）在 `step/end`、`sandbox/mode`、preset 切换等事件上反复撤销/重授 grant（`ptc.js:251-271`，这几处都会调用 `rotateFiles(entry)`）。
- 共享文件运行时：`lib/publication/scope-owner.js:26` 的 `SHARED_FILE_APIS`（inspect_local_file / replace / write_file / edit_file / copy / move / remove / stat / grep / glob / read_files / diff / read_table / read_docx / read_pdf / result）走 `acquireSharedFile`，同一个 runtime 内每个 api 建一个租约再 grant（`lib/publication/native.js:52-63` 顺序 acquire）。
- **关键差异**：PTC 侧的 `execute` 校验对 file 组件做了短路 ——
  ```js
  // lib/publication/ptc.js:70-75
  const current = () => ... && revision === presentationRevision && permitted(entry.agent, api) && selected(entry, api)
      && (capability(api)?.component === 'file'
          || tools.executable(publicToolName(api), entry.agent, exec.toolSet) === entry.definitions.get(publicToolName(api)));
  ```
  只要 `capability(api).component === 'file'` 就**跳过 executable 身份比对**。`stat / write_file / edit_file / diff / copy / move / remove / read_table / read_docx / read_pdf` 都是 component=file（见 `lib/capabilities/registry.js:8-20`），所以在 PTC 呈现下不该再撞这条 PUBLICATION_DENIED。
- 当前会话是**非 PTC 呈现**：工具直接以顶层工具出现在模型侧（`ops_stat`、`ops_write_file` 等可点名调用），而 `isPtc()` 的判据是「assembly.tools 只有 1 个且名为 `run_code`」（`lib/publication/ptc.js:61-65`）。因此现在走的是 native/standard 那条 `registrar.execute` 通道，正好命中 124 行校验。

### 4.3 为什么是这一组工具被拒

- 常驻集合来源：`PTC_RESIDENT_TOOLS`（`lib/capabilities/registry.js:55`）在 0.5.0 只含 `inspect_local_file` 与 `result`（FILE_CAPABILITIES 的 `ptcAvailability` 仅 inspect_local_file 为 resident）；再叠加 profile 的 `ptc.alwaysLoaded`（read_files / glob / grep / stat / write_file / edit_file）。
- 因此 stat / write_file / edit_file 是「由 PTC 行注入的常驻工具」，而 inspect / read_files / grep / glob / copy / replace 还同时被 standard/discovery 行注册过；两套 publisher 交替中标时，前者的定义身份更容易在后一次 `tools/change` 轮换中失效 → 表现为「同一批 shared API 里，只有 PTC 独有注入的那几个被拒」。这是推断，未进一步在宿主内部打点验证。

## 五、切到 PTC 模式后的复测清单

切换动作由用户执行（preset 选择 `ptc`，或把 `agent-preset-registry.selectedDefault` 改为 `ptc` 后重开会话）。切换后请按顺序验证：

1. 呈现确认：模型侧工具应只剩 `run_code`（+ 官方基础工具），`isPtc` 判据成立；ops API 改为在 `run_code` 内通过 SDK 调用。
2. 逐个调用并记录原始返回（**这是本次交接的核心验收点**）：
   - `stat`（`expectedRevision` 由 `inspect_local_file` 的 revision 提供）
   - `write_file`（先 `expectedRevision: "absent"` 建新文件，再按 revision 覆写）
   - `edit_file`（单处 oldText→newText）
   - `diff`、`remove`、`move`
   - `read_table` / `read_docx` / `read_pdf`（可用不存在路径触发，只看是否 PUBLICATION_DENIED）
3. 判定标准：返回真实的业务结果（含 `status: "completed"` 或参数错误 `INVALID_ARGUMENT`）即视为通过；只有再次出现 `PUBLICATION_DENIED` 才算缺陷仍存在。
4. 若仍被拒：把 `lib/publication/ptc.js:66-92` 的 `current()` 与 `lib/publication/registrar.js:112-184` 的 `refresh()` 对照打点，重点看 `presentationRevision`（`ptc.js:44-45`，每次 `system-prompt/change` 自增）是否在 step 内被刷新 —— 这是除 executable 身份之外的第二个嫌疑点。
5. `ops_result` 单独看：PTC 下它走 `lib/projections/native/result.js`，需要 `run_code` 父调用与当前 PTC admission；若宿主仍无结果存储能力，`EXECUTOR_UNAVAILABLE` 属预期。

## 六、清理与遗留

- 探针文件已全部删除：`.ops-copy-probe.json`、`.ops-probe-src.txt`、`.ops-probe-dst.txt`、`.ops-probe-a.txt`、`.ops-probe-new.txt`、`.ops-probe-copy2.txt`、`.ops-sub-probe.txt`。
- 仓库当前未跟踪项（均为既有产物，与本次任务无关）：`.codebuddy/`、`.dsh-auto-pass/`、`_shot.png`、`preview-filter-bar.html`。
- **未提交 issue**：PUBLICATION_DENIED 现象尚未反馈到 `D:\work\github\dsh-ops` 仓库。若 PTC 下仍复现，建议带本文件第四节 + 复测原始返回提 issue。
- 已知无害日志噪音（2026-11-04 旧记录，非本次）：`dsh-ops: inherited bash restriction failed: tools.restrict() names unknown global tool "ops_bash"`。

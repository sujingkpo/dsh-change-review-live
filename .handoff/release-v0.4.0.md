# dsh-change-review-live v0.4.0

> 兼容版：**认领 dsh-ops 的写工具与 `ops_bash`**，并新增**历史数据清理**（定时 + 手动）；顺带补上 DSH 版本护栏。

## 本版新增

### 兼容 dsh-ops（0.5.0）

- **`ops_write_file` / `ops_edit_file` 现在会进改动记录**：这两个工具的结果载荷里**没有文件内容**（只有 `revision` / `bytes` / `lineCount`），所以改成「执行前读盘存基线 + 执行后读盘」拿前后内容——diff、撤回、行号都正常，记录上标 `via: ops_write_file|ops_edit_file`。
- **字段口径已对齐**：dsh-ops 用 `path`（不是 `file_path`）；`ops_write_file.content` 是整份文件；`ops_edit_file.edits[{oldText,newText}]` 是片段数组。空操作判定也扩到这两者（`edits` 里任一条 `oldText === newText` 就丢弃）。
- **`ops_bash` 记为命令来源**：走命令前后文件快照做差，并**按 `workdir` 切换快照目录**（相对路径按会话 cwd 解析）——此前命令在子目录里落盘会一条都抓不到。
- 内置 `write` / `edit` 的行为完全不变（仍然直接用载荷里的前后内容，仍然**不写 `via`**）。

### 历史数据清理

`设置 → 实时审查` 底部新增一块「历史数据清理」：

- **用量**：会话记录与 UI 偏好各占多少文件 / 多少体积，配「最近 1 天 / 1 周 / 1 月 / 更早」四档年龄分布，以及**按当前设置能清掉多少**的预估
- **六个参数**：保留天数（1–3650）、保留最近 N 个会话（0–1000）、清理周期小时（1–720）、定时清理开关、同时清理 UI 偏好、保护当前会话
- **默认值**：保留 30 天 / 保留最近 5 个 / 每 6 小时 / **定时清理默认关闭** / 同时清 UI 偏好开着 / 保护当前会话开着——即装即用也不会自己删东西
- 「立即清理」会先就地展开一行确认（写明这次将删多少文件、多少体积），确认后才执行；清理会**同时把内存里的会话记录摘掉**，否则退出兜底会把删掉的文件重新写回来
- 配置存在 `$DSH_HOME/diff-review/cleanup.json`，`cleanup.json` 自身既不计数也不删；定时器每轮重读配置，保存后按新周期重排

### DSH 版本护栏

- `package.json` 新增 `engines.dsh = ">=0.2.2-rc.1 <0.2.3-0"`。此前插件既没有 `engines` 也没有 `peerDependencies`，DSH 的装载器对版本零约束（不告警、不拒载）。
- `dsh.client.inject` 删掉了 `@deepseek-ai/dsh-client-runtime`——这个包在 DSH 0.2.2-rc.1 的 asar 里、在 npm 上都查不到，是插件清单里的历史脏数据；DSH 对未命中的 inject 项本来就会跳过，删掉不影响加载。

## 兼容性核查

- 对 DSH **0.2.2-rc.1** 做了逐项核对：`session/event`、`tools/change`、`tools/pre-execute`、`tools/result` 四个 Host 事件的签名与载荷（`{ callId, rootCallId?, name, arguments, agent? }`）都与插件现有用法一致；`exec.agent.session.header.cwd` 成立；`write` / `edit` / `pwsh` / `bash` / `run_code` 五个内置工具名都在；客户端 `sidebar.right.pane.tab` / `.tab.title` / `conversation.input.dock` / `settings.section` 四个席位与 `useTabInfo`、`openResource` 调用方式都未变。**结论：依赖面无破坏性变化。**

## 影响范围 / 升级

本版**同时改了 Host（`lib/index.js`）与浏览器端（`lib/client.js`）**：Host 新增记录分支与清理路由，浏览器端新增设置区块。**升级后需要重启 DSH Desktop**（Host 改动才会生效），再刷新页面。状态文件格式**没有变化**，已有记录不用重建；旧记录的 `via` 为空，仍按原规则显示。

```sh
dsh plugin --profile desktop add github:sujingkpo/dsh-change-review-live
```

装到 `dsh web` 的 profile 时把 `desktop` 换成 `web`。

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

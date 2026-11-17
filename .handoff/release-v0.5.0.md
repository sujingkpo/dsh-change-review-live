# dsh-change-review-live v0.5.0

> 性能与长会话专项版：审查记录改为**按文件碎片化存储**、状态文件 gzip 压缩与快照预算收紧、修复多处内存泄漏与无上限增长；同时**关闭命令前后快照兜底**（脚本直写不再记录）。状态存储格式**不向后兼容**旧版。

## 本版重点

### 存储：按文件碎片化

- 每会话由「单文件」改为「目录」：`meta.json.gz`（文件名 / 统计 / 每文件 hash 的轻量索引）+ 每文件一个 `<hash>.content.gz`（该文件完整 ops / 快照）。
- 进入会话只读 meta（KB 级）；打开文件 / 查看轮次 / 撤回时才按 hash 懒加载对应碎片。
- 实测最大 67MB 会话（606 op）：旧单文件纯 gzip 8.96MB；碎片化后进入会话仅读轻量索引，磁盘与解析成本随「只看哪个文件」摊开。

### 存储：gzip 压缩 + 快照预算收紧

- 状态写盘前 `gzipAsync`（libuv 线程池，不阻塞事件循环），退出同步 flush。
- 单会话 op 快照预算 `SESSION_SNAPSHOT_BUDGET` 默认 128MB → **24MB**（`DRV_SNAPSHOT_BUDGET` 可覆盖）；几十 MB 的老会话一进内存即裁到预算内，磁盘随之缩小。被裁 op 仍用片段（入参 `oldString`/`newString`/`content`）展示，仅失去精确 diff 与逐项撤回。
- 实测 67MB 会话：纯 gzip 8.96MB；叠加 24MB 裁剪后落盘 3.7MB（606 op 裁掉 472 个老快照）。

### 内存：修复泄漏与无上限增长

- 客户端：编辑器下拉的 `keydown`、拖拽的 `mousemove`/`mouseup` 改用**同一函数引用** add/remove（原先两处箭头函数实例不同，移除失效、反复开关会累积监听），并在组件卸载时兜底移除。
- 服务端：`repoRootCache` / `turnTimelineCache` / `turnQuestionCache` 按 `trimMap(500)` 丢最早键；内存会话表按最近访问保留上限（淘汰后从磁盘懒加载）；单会话 op 快照按预算裁剪；SSE clients 在路由 dispose 时 `end()` + 清理。

### 载荷按需截断 + 超大段懒加载（P2）

- `/file` 与 `/against`：单段超 1500 行先截断，回传真实总数 `totalRows` 与被截数 `omitted`；客户端点「显示剩余」时带 `fullop` 重取全量，换文件 / 换对比模式 / 手动刷新即重置。
- 超预算不等于丢内容：块内仍完整做 LCS，只是分块进行、块边界退化为整块删增。

### 面板：行级订阅与缓存

- 行配色 / 语法订阅收敛到 `Section` 统一读取（1500 行不再产生 3000 个 store 订阅）。
- `/file` 响应内容未变时复用旧数据、跳过全量重渲染；`tokenize` 与快照 diff 结果按内容签名缓存（diff 缓存上限 16 / LRU）；状态持久化改**异步串行写**、退出同步 flush。

## 行为变更（重要）

- **关闭命令前后快照兜底**（`SHELL_SNAPSHOT_ENABLED = false`）：只保留 `write` / `edit` / `ops_write_file` / `ops_edit_file` 四个写工具的**精确路径**记录；**脚本直写、命令内产生的改动不再记录**。
- 原因：快照口径是整个工作区（`git status` 全部脏文件 / 目录遍历），不是命令真实足迹；同工作区多会话并发时，执行窗口内被其它会话写工具改过的文件会被误判为本会话这条命令改的（实测 4 个会话、22 个文件串入）。恢复前需先做跨会话归属判定。

## 兼容性 / 升级提示（重要）

- 状态存储由「每会话单文件 `<sessionId>.json`」改为「每会话目录（`meta.json.gz` + 内容碎片）」。**旧格式兼容与历史迁移代码已整体移除**：升级后 **0.4.0 及更早版本记录的历史审查数据不会再显示**（旧单文件不会被读取，也不计入清理统计）。如需保留旧记录，请在升级前备份 `$DSH_HOME/diff-review/`（`DSH_HOME` 未设置时为 `~/.dsh`）。
- 本版同时改了 Host（`lib/index.js`）与浏览器端（`lib/client.js`）：**升级后需重启 DSH Desktop**（Host 改动才会生效），再刷新页面。

## 验证

- `node --check lib/index.js` / `node --check lib/client.js` 通过；`lib/*.js` 保持 CRLF 且 0 个裸 LF，`AGENTS.md` 为 LF。
- 各提交离线单测通过：`enforceSnapshotBudget` 预算裁剪、gz 读写与旧格式迁移删除、`/file` handler（6 项）与 `Section` 组件树（10 项）、应用冒烟等。

```sh
dsh plugin --profile desktop add github:sujingkpo/dsh-change-review-live
```

装到 `dsh web` 的 profile 时把 `desktop` 换成 `web`。

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

# dsh-change-review-live v0.3.0

> 功能版：审查列表标题栏**只显示最近修改的文件**（不再拼接用户消息），并新增**漏斗快捷筛选 / 搜索**。

## 本版新增

### 标题栏摘要改版

- **只列最近修改的文件名**：不再拼接「用户消息」段。最多显示 5 个（`LIVE_SUMMARY_FILES`），超出时尾部补「…（共 N 个）」，**悬停提示里给全部文件名**——被省略号截断的文件照样能查回来
- **摘要独占标题栏剩余宽度**：此前摘要与占位块 `.drv-header-spacer` 的 flex-grow 都是 1，剩余宽度被对半分，于是文件名提前截断、按钮左侧还留一段空位。现在**占位块只在没有摘要时才渲染**：有摘要 → 宽度全归摘要；没有摘要（可见列表为空）→ 占位块补位，右侧按钮仍靠右
- 提问没有消失：仍在**列表行**（「全部轮次」视图的行尾）与行的悬停提示里

### 快捷筛选 + 搜索

- 标题栏一枚**漏斗按钮**，就地展开筛选区（搜索框 + 状态 / 来源 / 轮次三组 chip），**列表留在下面实时过滤**，折叠成摘要条时也能打开
- **全程客户端内存过滤**，不新增取数接口；关键词命中「路径 / 文件名 + 用户提问 + 工具名 + 状态」四字段并集，空格分词后每个词都要命中（允许落在不同字段），大小写不敏感，**中英文别名都认**（新增=added、修改=modified、编辑=write/edit、命令=其余一切…）
- 漏斗角标 = 生效条件数；筛选生效时计数从「N 个文件」变成「**命中 N / 范围 M**」；无命中时空态给「清空筛选」一键出口
- **选中任意轮次 chip 会自动切到「全部轮次」**（具体轮次的数据只在全量列表里）
- Host 侧配套：`summary` 载荷新增 `question` 字段（该文件最后一次改动所属轮次里的用户提问）——「全部轮次」视图用的是 summary 载荷，此前没有 `sections`，按提问搜索在那个视图恒为空

## 影响范围 / 升级

本版**同时改了 Host（`lib/index.js`）与浏览器端（`lib/client.js`）**：Host 新增 `summary.question` 字段。**升级后需要重启 DSH Desktop**（Host 改动才会生效），再刷新页面。状态文件格式**没有变化**，已有记录不用重建；旧记录（`turn=0`）的 `question` 是空串，不报错。

```sh
dsh plugin --profile desktop add github:sujingkpo/dsh-change-review-live
```

装到 `dsh web` 的 profile 时把 `desktop` 换成 `web`。

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

# dsh-change-review-live v0.1.0

> **首个发布。** 本项目 fork 自 [cirelir/dsh-change-review](https://github.com/cirelir/dsh-change-review)，在其基础上把审查界面整体迁到 DSH 的右侧栏。

## 这是什么

DSH（DeepSeek Harness）插件「实时审查」：实时追踪会话内的 `write` / `edit` 工具调用，把改动以行级 diff 呈现——改动列表常驻输入框上方，diff 正文在右侧栏的独立标签页里查看；会话隔离、子代理聚合、SSE 推送。

## 安装

```sh
dsh plugin --profile web add github:sujingkpo/dsh-change-review-live
```

装到 DSH Desktop 的 profile 时把 `web` 换成 `desktop`。**安装后重启 DSH。**

## 本版功能

- **审查列表**（输入框上方，默认折叠）：状态胶囊（新增 / 修改 / 删除）、路径、轮次徽章、该轮问题、`+N/−N`、时间；展开后可拖拽调整高度（按会话记忆）
- **右侧栏 diff 标签页**：标题为「文件名 (diff)」并带红/绿 diff 图标；正文支持「会话记录 / 初始版本 / Git 版本」三段对比
- **撤回**：单项撤回（三路行合并，保留其后无冲突的改动）与整文件撤回（会话中新建的文件则删除），写入磁盘前二次确认
- **实时刷新**：SSE 推送 + 15 秒兜底轮询；「会话记录」随改动自动刷新，对比模式用「刷新」按钮手动重取，面板不可见时暂停
- **打开文件**：优先在 DSH 右侧栏内预览，失败降级为系统默认程序；diff 行右键可复制「文件地址#行号」（选中多行时复制行号范围）
- **颜色自定义**：设置 → 实时审查（12 项颜色 + 透明度滑块 + 浅色 / 深色预设 + 恢复默认）

## 与上游的差异

- 审查界面整体改造：由「审查」视图标签页 + 每轮变更卡片，改为**输入框上方的审查列表 + 右侧栏 diff 标签页**
- 已移除：审查视图标签页与数量角标、轮次变更卡片、编辑器选择器（打开文件走右侧栏预览或系统默认程序）
- 包名与仓库更名为 `dsh-change-review-live`，中文名「实时审查」
- 保留上游的 MIT 许可与版权声明（`Copyright (c) 2026 cirelir`）

## 运行要求

- 依赖 DSH 的右侧栏 API（`sidebarRightTabs` / `sidebarRight`）
- 无构建步骤：`lib/index.js`（Host）与 `lib/client.js`（浏览器 bundle）直接随包发布

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

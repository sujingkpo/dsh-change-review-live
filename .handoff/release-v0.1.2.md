# dsh-change-review-live v0.1.2

> 修复版。v0.1.1 引入「审查列表按当前轮次刷新」后，**展开的列表在每次新改动时会闪动**——本版修掉它。

## 本版修复

- **展开审查列表时不再闪动**：此前同一轮次内每来一次新改动，列表都会先被替换成「加载当前轮次…」再重建（SSE 每记录一次改动都会触发重取，旧实现每次重取都清空列表）。现在**只有换轮次 / 换会话才清空**，同轮次内是原地替换
- **内容没变化就不重渲染**：取回的文件列表会先与当前内容做展示字段签名比较（路径 / 状态 / 时间 / 改动量 / 轮次 / 工具标签 / 是否工作区外 / 本轮问题），一致即复用原数组，React 不再做无谓渲染
- **面板被重新挂载时立即出内容**：新增模块级缓存（键 = 会话 + 轮次，上限 8 条），重新挂载的瞬间就有列表，不再闪一下加载提示
- **取数失败保留已有列表**：失败只解除「加载中」，不会把已经显示的内容清掉

## 安装 / 升级

```sh
dsh plugin --profile web add github:sujingkpo/dsh-change-review-live
```

装到 DSH Desktop 的 profile 时把 `web` 换成 `desktop`。本版**只改浏览器端 bundle**，升级后**刷新页面即可**（若同时从 0.1.0 升级，仍需重启一次 DSH 以加载 0.1.1 的 Host 端改动）。

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

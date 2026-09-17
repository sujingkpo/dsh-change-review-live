# dsh-change-review-live v0.1.1

> 第二个发布。本版聚焦**审查列表的可用性**与**改动发现能力**：列表按当前轮次刷新、展开态不再被重置、新出现了「只查看删除态 / 工作区外」的视图，并补上此前完全抓不到的 shell 直写改动。

## 本版新增 / 修复

### 审查列表

- **按「当前轮次」刷新**（不再逐轮回退）：每轮一开始列表就切到这一轮；本轮没有变更时显示「本轮暂无变更」，不会继续展示上一轮的旧信息
- **展开态跨重挂载保持**：面板在新轮次 / 会话重建时不再自动折叠；展开 / 折叠状态按会话记忆（本机内存 + `$DSH_HOME/diff-review/ui/<sessionId>.json`）
- **只查看删除态 / 工作区外文件**：两枚范围按钮改为可取消（点已选中的那枚即取消选中），范围全取消后列表内容完全由「已删除 / 工作区外」两个降噪开关决定；两个开关可叠加（并集，按路径去重）
- **标题栏摘要跟随当前视图**：前缀由「最近变动 / 全部轮次」与已打开的降噪开关组合而成，摘要里的文件名与问题都取自当前列表；列表为空时整段不显示
- **改动来源标签**：行内新增 `write` / `edit`（中性底）与 `pwsh` / `bash` / `run_code`（暖色底——表示这份 diff 取自命令前后的磁盘快照，不是工具直接给的）

### 记录能力

- **shell 类工具的写入发现**：`pwsh` / `bash` / `run_code` 直接落盘的改动此前一条都记录不到，现在用「命令前后文件快照做差」补记录（git 仓库全量发现 → 非 git 目录有界遍历 → 会话已记录文件的逐个 stat）
- **记录键归一为绝对路径**：同一文件不再因相对 / 绝对、Windows 大小写差异而分裂成两条记录

### 其它

- 移除跨根状态迁移（它服务的场景从未发生，收益为零、风险是丢数据）；状态根恒为 `$DSH_HOME/diff-review`
- 声明市场截图（`screenshots.json`）并记录插件商店收录流程

## 安装

```sh
dsh plugin --profile web add github:sujingkpo/dsh-change-review-live
```

装到 DSH Desktop 的 profile 时把 `web` 换成 `desktop`。**升级后请重启 DSH**——本版含 Host 端改动（轮次判定、shell 快照、UI 偏好），只刷新页面不够。

## 兼容性

- v0.1.0 的记录可直接沿用：没有任何轮次信息的旧记录按「全部轮次」处理
- 无构建步骤：`lib/index.js`（Host）与 `lib/client.js`（浏览器 bundle）随包发布

完整说明见 [README.zh.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.zh.md) / [README.md](https://github.com/sujingkpo/dsh-change-review-live/blob/main/README.md)。

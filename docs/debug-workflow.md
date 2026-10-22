# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：

- 快照与数据库驱动：`agent:game` 直接连接 PostgreSQL，不经过 HTTP 服务端。
- HTTP 走查：`agent:api` 逐步请求运行中的业务服务端。

两者最终都必须复用同一套业务服务层。CLI 只负责参数解析、状态读取与结果输出，规则校验、事务与持久化不能各写一份。

## 数据库驱动

`agent:game` 当前支持从数据库创建与推进一局游戏：

- `create --user demo`：创建 game、唯一 player、world、两个 stage、一条连接、一个 actor 与一个 item。
- `status --game <gameId|slug>`：读取完整游戏状态。
- `act --game <id|slug> --action move --to <stageId|stageName>`：沿连接移动玩家 actor，追加消息并递增版本。
- `snapshot --game <id|slug>`：把当前状态导出为只读快照。

它不需要启动 HTTP 服务端，但需要 `DATABASE_URL`。创建与动作都走共享业务服务层，后续 HTTP 路由直接复用同一层。

## 文件快照

`agent:game` 仍保留文件快照命令：

- `new --user <user> --game <game>`：手写一份开发快照。
- `list` / `latest` / `show` / `validate`：枚举、定位、查看与校验。

快照目录按 `worlds/<user>/<gameSlug>/<snapshotId>/` 组织，包含 `manifest.json`、`world.json`、`session.jsonl` 与可选 parts。数据库快照的 manifest 额外记录 `source`、`gameId`、`dbVersion` 与 `contentVersion`。

快照是数据库提交后的只读投影，用于观察、比对与留痕，不作为写入源。分支与回溯由数据库层负责，不通过修改快照文件实现。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束，便于 agent 判断并自我纠错。

当前命令是 `health`、`openapi` 与通用 `request`；业务动作路由接入后，再增加 `status`、`action` 等快捷命令。服务端地址通过 `--base` 或 `AGENT_API_BASE_URL` 提供，鉴权 token 通过 `--token` 或 `AGENT_API_TOKEN` 注入。

它不替代固定回归测试：可复现的契约校验仍应写成 `app.inject()` 测试；HTTP 走查用于探索、新特性验证与边界试探。

→ 参见：[架构与契约](architecture.md) → 参见：[数据库](database.md)

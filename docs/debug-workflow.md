# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：

- 数据库驱动：`agent:game` 直接连接 PostgreSQL，不经过 HTTP 服务端。
- HTTP 走查：`agent:api` 逐步请求运行中的业务服务端。

两者最终都必须复用同一套业务服务层。CLI 只负责参数解析、状态读取与结果输出，规则校验、LLM loop、事务与持久化不能各写一份。

## 数据库驱动

`agent:game` 当前支持从数据库创建并推进一局游戏：

- `create --user demo`：创建 game、player 座位、world、两个 stage、双向连接、三个 NPC、各自物品与 system memory。
- `status --game <gameId|slug>`：读取完整游戏状态。
- `npc --game <id|slug> --actor <actorId|actorName>`：推进一个 NPC 回合。
- `npc --game <id|slug> --all`：按当前 actor 顺序推进所有未被玩家接管的 NPC。
- `take-control --game <id|slug> --actor <actorId|actorName>`：玩家接管一个 actor。
- `release-control --game <id|slug> --actor <actorId|actorName>`：解除接管。
- `player-speak --game <id|slug> --actor <actorId|actorName> --mode say|whisper|announce [--target <actorName>] --message <text>`：以被接管 actor 的身份直接说话，不调用 LLM。
- `snapshot --game <id|slug>`：把当前状态与每个 NPC 的 memory 导出为只读快照。

NPC 回合由 agent loop 驱动：先读取环境与私有 memory，再通过 `look_stage` 与 `submit_action_plan` 工具决定行动；`look_stage` 可多次调用，`submit_action_plan` 是终止工具，handler 只收集计划，不写数据库。loop 结束后服务层在事务中校验并应用 `wait`、`move`、`say`。`say` 是有目标公开说话，向当前 stage 广播；`announce` 是无目标公开说话；`whisper` 必须指定单个 `targetActorName`，只有说话者与目标进入 memory。`game_messages` 用 `visibility` 区分公开与私密。

它不需要启动 HTTP 服务端，但需要 `DATABASE_URL` 与 `DEEPSEEK_API_KEY`。`agent:game status` 不调用 LLM，可用于观察当前状态。

## 文件快照

`agent:game` 仍保留文件快照命令：

- `new --user <user> --game <game>`：手写一份开发快照。
- `list` / `latest` / `show` / `validate`：枚举、定位、查看与校验。

快照目录按 `worlds/<user>/<gameSlug>/<snapshotId>/` 组织，包含 `manifest.json`、`world.json`、`session.jsonl` 与可选 parts。数据库快照额外记录 `source`、`gameId`、`dbVersion` 与 `contentVersion`，并通过 `memories/<actor>.json`、`memories/<actor>.meta.json` 导出每个 NPC 的私有上下文。

快照是数据库提交后的只读投影，用于观察、比对与留痕，不作为写入源。分支与回溯由数据库层负责，不通过修改快照文件实现。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束，便于 agent 判断并自我纠错。

当前命令是 `health`、`openapi` 与通用 `request`；业务动作路由接入后，再增加 `status`、`action` 等快捷命令。服务端地址通过 `--base` 或 `AGENT_API_BASE_URL` 提供，鉴权 token 通过 `--token` 或 `AGENT_API_TOKEN` 注入。

它不替代固定回归测试：可复现的契约校验仍应写成 `app.inject()` 测试；HTTP 走查用于探索、新特性验证与边界试探。

→ 参见：[架构与契约](architecture.md) → 参见：[数据库](database.md)

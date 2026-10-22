# 数据库

PostgreSQL 是游戏状态的唯一真相。`agent:game` 从数据库读取状态、调用 LLM 与工具、在短事务内应用结果；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

- `users`：账号身份，不进入游戏状态。
- `games`：一局游戏，聚合根；拥有 `owner_id`、稳定 `slug`、状态、内容版本与并发版本号。
- `game_players`：游戏中的座位/参与者；v1 一局只有一个 player，但不绑定 actor，不表示控制关系。
- `worlds`：游戏的世界状态，`game_id` 唯一，强制一局一个 world。
- `stages`：world 下的场景；`world_id` 非空，按 `ordinal` 保持稳定顺序。
- `stage_connections`：场景图的有向边；连接两端必须属于同一 world。当前 seed 为双向连接。
- `actors`：场景中的 NPC；`stage_id` 非空，不能脱离场景存在；当前没有玩家控制字段。
- `items`：角色持有的物品；`actor_id` 非空，不能脱离角色存在。
- `game_messages`：公共消息流，按 `sequence` 追加；记录 `stage_id`、`speaker_actor_id`、`target_actor_id` 与 `visibility`，供客户端增量拉取与审计；不建立 session 表。
- `agent_memories`：每个 agent 的私有上下文；当前 `owner_type` 为 `actor`，后续可扩展 stage / world。
- `agent_memory_messages`：agent memory 的消息序列，保存 system / human / ai / tool 与 tool_calls、元数据。

`game_messages` 与 `agent_memories` 不能合并。前者是公开事件，后者是私有上下文；`mind` 只进 memory，不进公共消息。

`world` 是 game 的运行时子状态，不是可复用内容模板。数据库 `worlds` 与文件目录 `worlds/` 同名但职责不同：前者是运行时状态，后者是导出的开发期快照。

## 开发数据

`seeds/dark-fantasy.ts` 提供黑暗奇幻的战役设定、全局规则、两个场景、双向连接、三个 NPC 与各自物品；故事内容留在 seed 层，不写进服务逻辑。

`pnpm db:demo` 应用迁移、清空登记过的开发表、写入固定 demo 用户与 `app_meta`。`pnpm agent:game create --user demo` 创建一局游戏，同时生成 player 座位、world、stage 图、三个 NPC、物品与各自的 system memory。

## NPC 行动

NPC 回合是：数据库环境 → agent loop → `submit_action_plan` → 短事务应用 → 公共消息与 memory 反馈。

工具包含可多次调用的只读 `look_stage`，以及作为终止工具的 `submit_action_plan`。`submit_action_plan` 是语义上的提交动作，但 handler 只收集计划，不写数据库。工具 handler 不写数据库；loop 结束后由服务层重新校验计划并在事务中更新 actor、game version、公共消息与 memory。

第一版动作是 `wait`、`move`、`say`、`whisper`、`announce`：等待、沿连接移动、有目标公开说话、有目标私下耳语、无目标公开说话。`say` 与 `whisper` 必须指定单个 `targetActorName`；`say` 向当前 stage 广播，`whisper` 只有说话者与目标收到 memory；`announce` 无目标，向当前 stage 广播。公共消息用 `visibility` 区分 `stage` 与 `private`；私密事件后续对客户端不可见。

`agent:game npc --game <gameId|slug> --actor <actorId|actorName>` 推进一个 NPC；`--all` 按当前顺序推进所有 NPC。`agent:game status` 读取完整状态；`agent:game snapshot` 导出快照，包含每个 NPC 的 memory。

## 迁移与重置

schema 定义在服务端代码中，SQL 迁移由 Drizzle Kit 生成并入库。迁移是唯一建表路径，不在应用启动时调用隐式同步。

`pnpm db:migrate` 应用迁移；`pnpm db:reset --yes` 清空显式登记的开发表；`pnpm db:check` 探测连接与基础设施表。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记。`db:reset` 与 `db:demo` 只允许本机数据库；数据库重置不会删除 `worlds/` 下的历史快照，需要时手动清理。

## 事务边界

LLM 调用不放进数据库事务：先读取状态与 memory，在事务外完成 agent loop，再用行锁与版本号在短事务内应用计划。

快照是提交后的只读投影，不是第二套状态源。快照失败只记录日志，不回滚业务；正式环境通过开关关闭落盘。`game_messages` 的说话事件同时保存 stage、speaker、target、visibility；`say` 的 memory 文本按说话者、目标、旁观者生成；`announce` 按说话者与旁观者生成；`whisper` 只生成说话者与目标两人的版本。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

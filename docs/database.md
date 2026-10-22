# 数据库

PostgreSQL 是游戏状态的唯一真相。`agent:game` 从数据库读取状态、调用 LLM 与工具、在短事务内应用结果；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

- `users`：账号身份，不进入游戏状态。
- `games`：一局游戏，聚合根；拥有 `owner_id`、稳定 `slug`、状态、内容版本与并发版本号。
- `game_players`：游戏中的座位/参与者；v1 一局只有一个 player。
- `actor_controls`：玩家接管 actor 的显式关系；有记录时该 actor 不再由 NPC loop 驱动。
- `worlds`：游戏的世界状态，`game_id` 唯一，强制一局一个 world。
- `stages`：world 下的场景；`world_id` 非空，按 `ordinal` 保持稳定顺序。
- `stage_connections`：场景图的有向边；连接两端必须属于同一 world；演示世界使用三组双向连接，浅眠墓穴到灰庭另有一条单向出口。
- `actors`：场景中的角色；`stage_id` 非空，不能脱离场景存在；当前没有玩家控制字段；根属性为 `hp` / `max_hp` / `attack` / `defense` / `speed` / `death`；`skills` 与 `status_effects` 是 actor 的两个 JSONB 容器。
- `items`：角色持有的物品；`actor_id` 非空，不能脱离角色存在；与 `skills`、`status_effects` 共同构成 actor 的三个运行时队列。物品行包含 `count`、`damage` 与 `block`；`kind=weapon` 的物品使用武器字段。
- `stage_items`：暂放在场景中的物品；`stage_id` 非空，当前只作为场景内容读取，已支持拾取并转入 actor 背包。物品行包含 `count`、`damage` 与 `block`。
- actor 的 `skills`：技能队列，JSONB 数组；每项包含 `key`、`name`、`description`、`broadcast`、`resolution`、`purposeKinds` 与 `itemPolicy`。`use_item` 同时承载 `damage` 与 `use` 两种目的；`steal`、`give`、`pickup` 保持独立。
- actor 的 `status_effects`：状态队列，JSONB 数组；每项包含 `key`、`name`、`description` 与 `kind`（buff/debuff）。当前系统不解释状态行为，只提供容器；鼠王的沉睡是角色 profile 中的叙事约束，由 LLM 判断何时苏醒，不写入系统规则。
- `game_messages`：公共消息流，按 `sequence` 追加；记录 `stage_id`、`speaker_actor_id`、`target_actor_id` 与 `visibility`，供客户端增量拉取与审计；不建立 session 表。
- `agent_memories`：每个 agent 的私有上下文；当前 `owner_type` 为 `actor`，后续可扩展 stage / world。
- `agent_memory_messages`：agent memory 的消息序列，保存 system / human / ai / tool 与 tool_calls、元数据。

`game_messages` 与 `agent_memories` 不能合并。前者是公共事件，后者是私有上下文；`mind` 只进 memory，不进公共消息。玩家接管只在 `actor_controls` 增加关系，不改变 actor 本体。

`world` 是 game 的运行时子状态，不是可复用内容模板。数据库 `worlds` 与文件目录 `worlds/` 同名但职责不同：前者是运行时状态，后者是导出的开发期快照。

## 开发数据

`seeds/dark-fantasy.ts` 提供黑暗奇幻的战役设定、全局规则、五个场景、三组双向连接、一条单向出口与五个角色；故事内容留在内容定义层，不写进服务逻辑。守墓人持有 `饰品.封骨钥匙`，焚毛炉房放置 `武器.焚鼠火把`，鼠王在骨厅沉睡；这些是初始内容，不是服务逻辑中的硬编码。具体剧情、测试目的与暂缓项见临时测试剧本。

`World` / `Actor` / `Stage` 是创建世界用的初始内容定义，不是测试专用，也不是数据库模型。`createGame` 读取 `World`，在一个事务中写入 `worlds`、`stages`、`stage_items`、`actors`、`items` 与 memory；创建完成后 PostgreSQL 是唯一真相，修改内容定义不会回改已有游戏。`World.initialStageKey` 决定初始旁白所属场景；演示世界从浅眠墓穴开始。测试使用独立的小型世界，不随演示剧情变化。`pnpm db:seed` 是数据库 seeding 的固定叫法，只写 demo 用户与 `app_meta`；`pnpm db:demo` 重置后再写这些基础数据；`agent:game create` 才把 `World` 物化为具体游戏。

`pnpm db:demo` 应用迁移、清空登记过的开发表、写入固定 demo 用户与 `app_meta`。`pnpm agent:game create --user demo` 创建一局游戏，同时生成 player 座位、world、五段 stage 图、五个角色、场景物品、角色物品与各自的 system memory。

## NPC 行动

NPC 回合是：数据库环境 → agent loop → `communicate` / `move` / `use_skill` 暂存 intent → `submit_plan` → 短事务按顺序应用 → 公共消息与 memory 反馈。

工具包含只读 `look_stage`、`get_stats`、`get_items`、`get_actor`，以及三个 intent 工具 `communicate`、`move`、`use_skill`；`look_stage` 与环境提示都会列出当前场景的 `stage_items`，`get_items` 只列 actor 自己的物品，`get_actor` 查看同场景目标的 stats、状态与背包；`submit_plan` 是终止工具。只读工具可多次调用；工具按模型返回的 `tool_calls` 顺序串行执行。`communicate` 暂存 `say`/`whisper`/`announce`，`move` 暂存 `move`/`wait`，`use_skill` 暂存技能、道具与目的；同类 intent 互斥，沟通类与行动类可以共存，顺序按工具调用顺序保留。所有 handler 只收集计划，不写数据库；loop 结束后由服务层重新校验并在事务中按顺序更新 actor、game version、公共消息与 memory。

第一版动作是 `wait`、`move`、`say`、`whisper`、`announce` 和技能 `use_item`、`steal`、`give`、`pickup`：等待、沿连接移动、沟通、战斗、物品转移、场景拾取与使用道具；它们被收进三个 intent 工具；每个成功应用的 intent 都会写一条公共事件。`use_item` 的 `damage` 目的、有无武器都可执行：伤害为 `max(0, 攻击者 attack + 所选武器 damage - 目标 defense)`；空手时不加武器 damage，目标 `defense` 是唯一 block，目标物品 block 与发起者物品 block 都不参与当前伤害计算。伤害事件仍以 `kind=attack` 记录。`use_item` 的 `use` 目的需要自身物品，目标只能是当前场景、自己或同场景角色。武器是物品的子类型，`count` 固定为 1，额外携带 `damage` 与 `block`；`damage` 参与伤害，`block` 当前只存储、不参与伤害。`steal` 为 private，只有发起者与目标进入 memory，允许从尸体取物；`give` 把自身物品交给同场景存活角色；`pickup` 把 `stage_items` 移入 actor 背包。当前钥匙通关硬编码 `场景.封骨之门` 与 `饰品.封骨钥匙`，成功后 `games.status=completed`。`say` 与 `whisper` 必须指定单个 `targetActorName`；`say` 向当前 stage 广播，`whisper` 只有发起者与目标收到 memory；`announce` 无目标，向当前 stage 广播。公共消息用 `visibility` 区分 `stage` 与 `private`；私密事件后续对客户端不可见。

`agent:game npc --game <gameId|slug> --actor <actorId|actorName>` 推进一个 NPC；`--all` 跳过被玩家接管或已死亡的 actor。`agent:game take-control` / `release-control` 接管或释放一个 actor；`agent:game player-communicate --mode say|whisper|announce` 让被接管的 actor 直接执行三种沟通动作；`agent:game player-move --to <stageName>` 让被接管的 actor 沿连接移动；`agent:game player-skill --skill <key> [--target <actorName>] [--stage <stageName>] [--item <itemName>]` 让被接管的 actor 直接使用通用技能；`agent:game player-attack --target <actorName>` 保留为攻击快捷入口。`agent:game status` 读取完整状态；`agent:game snapshot` 导出快照，包含每个 actor 的 memory。状态队列目前不驱动行动；沉睡与苏醒由 actor profile / system prompt 约束，并由 LLM 在正常 plan 中判断，系统不为特定状态维护唤醒规则。

## 迁移与重置

schema 定义在服务端代码中，SQL 迁移由 Drizzle Kit 生成并入库。迁移是唯一建表路径，不在应用启动时调用隐式同步。

`pnpm db:migrate` 应用迁移；`pnpm db:reset --yes` 清空显式登记的开发表；`pnpm db:check` 探测连接与基础设施表。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记。`db:reset` 与 `db:demo` 只允许本机数据库；数据库重置不会删除 `worlds/` 下的历史快照，需要时手动清理。

## 事务边界

LLM 调用不放进数据库事务：先读取状态与 memory，在事务外完成 agent loop，再用行锁与版本号在短事务内应用计划。

快照是提交后的只读投影，不是第二套状态源。快照失败只记录日志，不回滚业务；正式环境通过开关关闭落盘。`game_messages` 的沟通事件同时保存 stage、speaker、target、visibility；`say` 的 memory 文本按发起者、目标、旁观者生成；`announce` 按发起者与旁观者生成；`whisper` 只生成发起者与目标两人的版本。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[临时测试剧本](test-scenario.md) → 参见：[数据驱动目标](data-driven.md)

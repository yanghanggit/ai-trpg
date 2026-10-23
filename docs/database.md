# 数据库

PostgreSQL 是游戏状态的唯一真相。`agent:game` 从数据库读取状态、调用 LLM 与工具、在短事务内应用结果；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

- `users`：账号身份，不进入游戏状态。
- `games`：一局游戏，聚合根；拥有 `owner_id`、稳定 `slug`、状态、内容版本与并发版本号。
- `game_players`：游戏中的座位/参与者；v1 一局只有一个 player。
- `actor_controls`：玩家接管 actor 的显式关系；有记录时该 actor 不再由 NPC loop 驱动。
- `worlds`：游戏的世界状态，`game_id` 唯一，强制一局一个 world；`actions` 是 world 实体的能力清单（当前 `notify_stage` / `end_game`）。
- `stages`：world 下的场景；`world_id` 非空，按 `ordinal` 保持稳定顺序；`key` 是内容层稳定 key（旧数据可能为空），`environment` 是当前环境快照，由 stage 小 GM 更新。
- `stage_connections`：场景图的有向边；连接两端必须属于同一 world；演示世界使用三组双向连接，乱葬坑到墓园另有一条单向出口。
- `actors`：场景中的角色；`stage_id` 非空，不能脱离场景存在；当前没有玩家控制字段；`appearance` 是当前可见外观（含衣着、装备与伤势，text），`base_body` 是未穿装备的种族 + 裸体描述（JSONB），`stats` 是根属性（JSONB：`hp` / `maxHp` / `attack` / `defense` / `speed`），`status` 是 `alive | dead` 枚举（默认 `alive`），`equipment` 是槽位到物品名的索引（JSONB），`actions` 是该角色被允许的动作列表（JSONB 数组，必须显式写入，无默认值；例如动物不含道具操作）；`query` 作为只读能力写在同一 `actions` 列表中，拥有它的 actor 才会在 plan 中看到知识检索工具。
- `stages.actions`：场景自身的能力清单，JSONB 数组；当前每个场景都声明 `submit_environment` 与 `notify_world`，决定 stage 小 GM 是否暴露这些工具。它不限制角色动作。
- `items`：角色持有的物品；`actor_id` 非空，不能脱离角色存在；是 actor 唯一的运行时队列。物品根字段有 `key` / `name` / `description` / `kind` / `count` / `affixes`，战斗数值在 `stats`（JSONB：`damage` / `block`），声明式使用效果在 `effect`（JSONB，必须包含 `type`）；`affixes` 是词缀字符串数组，默认空数组。物品自身不记录穿戴状态。
- `stage_items`：暂放在场景中的物品；`stage_id` 非空，当前只作为场景内容读取，已支持拾取并转入 actor 背包。字段与 `items` 相同，但没有穿戴状态。
- `game_messages`：公共消息流，按 `sequence` 追加；记录 `stage_id`、`source_actor_id`、`target_actor_id` 与 `visibility`，供客户端增量拉取与审计；不建立 session 表。
- `vector_documents`：公共知识向量；`collection` 隔离世界内容，`content_hash` 保证幂等，`embedding vector(384)` 由 pgvector 提供，`embedding_model` 防止不同模型向量混搜。它不进入 actor 私有 memory，也不承载剧情秘密。
- `agent_memories`：每个 agent 的私有上下文；`owner_type` 支持 `actor`、`stage` 与 `world`，world memory 属于全局叙事者；`context_usage_ratio` 记录最近一条 AI 消息的上下文占用比例。compact 后的 `[1]` human summary 在 metadata 中保存 `compactedMessages`，递归形成可回述的旧记忆树；`[0]` system 不参与压缩。
- `agent_memory_messages`：agent memory 的消息序列，保存 system / human / ai / tool 与 tool_calls、元数据。

## 属性与物品

`src/game/attributes.ts` 的 `ATTRIBUTE_DEFINITIONS` 是本系统 TRPG 属性总表：actor 的 `hp` / `maxHp` / `attack` / `defense` / `speed`，以及物品的 `damage` / `block`。新增属性先登记再决定作用域；所有计算通过 `attribute()` / `sumAttribute()` 读取，缺省为 0。

`ItemBaseState` 根字段有 `id` / `key` / `name` / `description` / `kind` / `count` / `effect` / `affixes`，没有根级 `damage` / `block`，也没有 `stats` 或穿戴状态；`ItemState` 是各 `kind` 子类的运行时联合。武器与装备扩展出 `StatItemState`（`stats`：`damage` / `block`）；饰品只有根字段。钥匙属于 `accessory`，显式声明 `effect: { "type": "event" }`，不携带战斗数值。`block` 目前只存储，不参与伤害计算。

`effect` 是物品的声明式行为：JSON 中必须包含 `type`，其余字段由对应 handler 解释。数据库只存 JSON，不存函数；`src/game/item-effects/` 用 `effect.type` 作为路由 key。当前注册了 `event` 与 `damage` 两个 handler，没有默认效果，也没有 `actions` 元数据。物品先执行默认 `effect`；如果 `affixes` 非空，再运行一次补充 affix agent。affix agent 在事务外调用 LLM 和工具，工具只收集操作，最后在短事务中落账；普通物品没有 affix 时只执行默认 effect。

`base_body` 是“捏脸完成、还没穿装备”的形态，`formatBaseBody()` 输出 `[种族] 描述`，system prompt 用 `### 基础体型` 展示它。`appearance` 是其他角色实际看到的样子，包含衣着、装备与当前伤势；内容可以显式提供，动物/怪物省略时回退到 `baseBody.description`。NPC 与 stage 的同场景观察只读 `appearance`，不会把人类看成裸体。

`appearance` 由一次 agent loop 推理得到：以 actor memory 为上下文，把 base body、`equipment` 槽位解析出的穿戴物品与记忆中的血迹/灰尘/伤势融合，通过 `submit_appearance` 提交；结果写回 `actors.appearance`。`setEquipmentSlot` 是换装入口，槽位变化后立即重算。推理不修改 system prompt，基础体型始终只读 `base_body`；seed 中的 `appearance` 是预先写好的推理结果。细节见外观文档 → 参见：[外观](appearance.md)。

`game_messages` 与 `agent_memories` 不能合并。前者是公共事件，后者是私有上下文；`mind` 只进 memory，不进公共消息。玩家接管只在 `actor_controls` 增加关系，不改变 actor 本体。

`world` 是 game 的运行时子状态，不是可复用内容模板。数据库 `worlds` 与文件目录 `worlds/` 同名但职责不同：前者是运行时状态，后者是导出的开发期快照。

## 开发数据

`seeds/dark-fantasy.ts` 提供黑暗奇幻的战役设定、全局规则、五个场景、三组双向连接、一条单向出口与五个角色；故事内容留在内容定义层，不写进服务逻辑。奥德里克持有 `饰品.闸门钥匙`，焚尸房放置 `武器.焚鼠火把`，鼠王在地窖沉睡；这些是初始内容，不是服务逻辑中的硬编码。具体剧情、测试目的与暂缓项见临时测试剧本。

`World` / `Actor` / `Stage` 是创建世界用的初始内容定义，不是测试专用，也不是数据库模型。`createGame` 读取 `World`，在一个事务中写入 `worlds`、`stages`、`stage_items`、`actors`、`items` 与 actor/stage memory；创建完成后 PostgreSQL 是唯一真相，修改内容定义不会回改已有游戏。`Actor.openingBriefing` 只用于建局注入：它在 actor memory 中写成 system prompt 之后的第一条 human message，不写入 `actors` 表。`World.initialStageKey` 决定初始旁白所属场景；演示世界从乱葬坑开始。测试使用独立的小型世界，不随演示剧情变化。`pnpm db:seed` 是数据库 seeding 的固定叫法，只写 demo 用户与 `app_meta`；`pnpm db:demo` 重置后再写这些基础数据；`agent:game create` 通过 `--seed`、`--world-file` 或 `--world` 显式提供 `World`，再把它物化为具体游戏。

`pnpm db:demo` 应用迁移、清空登记过的开发表、写入固定 demo 用户与 `app_meta`。`pnpm agent:game create --user demo --seed dark-fantasy` 创建一局游戏，同时生成 player 座位、world、stage 图、角色、场景物品、角色物品，以及 actor、stage 与 world 的 system memory；有 `openingBriefing` 的 actor 会额外写入一条开局简报 human message。

## NPC 行动

NPC 回合是：数据库环境 → agent loop → 动作工具暂存动作 → `submit_plan` → 短事务按顺序应用 → 公共消息与 memory 反馈。

工具包含只读 `look_stage`、`get_self`、`observe_actor`，以及十个动作工具 `say`、`whisper`、`announce`、`move`、`wait`、`attack`、`steal`、`give`、`pickup`、`use`；`look_stage` 与环境提示都会列出当前场景的 `stage_items`，`get_self` 返回自己的外观、stats、状态、穿戴与物品，`observe_actor` 只返回同场景目标携带的物品；`submit_plan` 是终止工具。只读工具可多次调用；工具按模型返回的 `tool_calls` 顺序串行执行。每个动作工具只接收自己的参数；一轮最多 `MAX_ACTIONS_PER_TURN = 2` 个动作，不分类互斥，顺序按工具调用顺序保留。所有 handler 只收集计划，不写数据库；loop 结束后由服务层重新校验并在事务中按顺序更新 actor、game version、公共消息与 memory。

第一版动作是十个平级动作 `say`、`whisper`、`announce`、`move`、`wait`、`attack`、`steal`、`give`、`pickup`、`use`：说话、耳语、宣告、移动、等待、攻击、取物、给予、拾取与使用道具；每个动作一个工具；每个成功应用的动作都会写一条公共事件，`kind` 取动作名。`attack` 与 `use` 是物品效果的 dispatcher：按 `item.effect.type` 路由到 handler。`damage` handler 执行 `max(0, 攻击者 stats.attack + 物品 stats.damage - 目标 stats.defense)`；随后如果物品有词缀，补充 affix agent 在事务外运行，并通过工具收集要追加的效果，最后在短事务中落账。空手攻击使用系统 `{ type: "damage" }`，目标 `defense` 是唯一 block。`event` handler 只写使用事件，后果交给 stage / world。`attack` 只接受 `damage` effect（NPC 工具也仅枚举这类物品）；`use` 接受全部物品。物品不再直接结束游戏。`WeaponState` 只通过 `stats.damage` 参与伤害，`stats.block` 当前只存储、不参与伤害。`steal` 为 private，只有发起者与目标进入 memory，允许从尸体取物；`give` 把自身物品交给同场景存活角色；`pickup` 把 `stage_items` 移入 actor 背包。`use` 的通用流程只校验物品归属、目标与场景；对场景使用时可以带 `targetDetail`，它作为 actor 的行动描述写入 stage memory，不代表结果。物品不再直接结束游戏；世界级后果由 stage 通知 world，再由 world 的 `end_game` 结束。`say` 与 `whisper` 必须指定单个 `targetActorName`；`say` 向当前 stage 广播，`whisper` 只有发起者与目标收到 memory；`announce` 无目标，向当前 stage 广播。公共消息用 `visibility` 区分 `stage` 与 `private`；私密事件后续对客户端不可见。

`agent:game npc --game <gameId|slug> --actor <actorId|actorName>` 推进一个 NPC；`--all` 跳过被玩家接管或已死亡的 actor。`agent:game take-control` / `release-control` 接管或释放一个 actor；玩家入口是十个子命令：`player-say` / `player-whisper` / `player-announce` / `player-move` / `player-wait` / `player-attack` / `player-steal` / `player-give` / `player-pickup` / `player-use`，每个子命令只接收自己的参数。`agent:game stage --game <gameId|slug> --stage <stageId|stageName>` 推动一个 stage 回合；`--all` 按场景顺序推动全部场景；`agent:game world --game <gameId|slug>` 推动 world 回合。`agent:game status` 读取完整状态；`agent:game scene-map` 返回场景名到角色名列表的映射；`pnpm rag:*` 管理公共知识向量，细节见公共知识检索文档；`agent:game snapshot` 导出快照，包含 actor、stage 与 world 的 memory；`agent:game compact` 手动压缩 actor/stage/world memory，保留 `[0] system`，把 `[1..]` 收敛成一条 human summary。沉睡与苏醒由 actor 的 `openingBriefing` 约束，并由 LLM 在正常 plan 中判断，系统不为特定状态维护唤醒规则。

## Stage 回合

stage 是活着的场景实体与小 GM，拥有自己的 `agent_memories` 记录、生命周期和显式推动的仲裁回合。当前能力只有更新 `stages.environment`。

stage 回合读取本场景全部事件，包括 private 沟通与移动进出；事件只进入 stage memory，不改变 actor 可见性。stage 回合通过 `submit_environment` 提交 environment 与 `notify_world` 通知：environment 可省略，但计划必须至少有一项。事务内校验 environment 不含角色名、更新场景、把通知写入 world memory、递增版本，写 `environment_change` 公共事件与 stage memory；不写 actor memory，actor 下一次 plan 重新读取当前 environment。它不会自动随 actor 行动运行，当前由 `agent:game stage` 显式推动。

world 回合读取 world memory 中的 stage 通知；可用 `notify_stage` 把世界裁决写入指定 stage memory，或用 `end_game` 结束游戏。`end_game` 必须是本轮最后一个动作，且只有 world 工具列表提供；stage 与 actor 都没有该工具。world 回合由 `agent:game world` 显式推动，不嵌在 stage 事务内。

## 迁移与重置

schema 定义在服务端代码中，SQL 迁移由 Drizzle Kit 生成并入库。迁移是唯一建表路径，不在应用启动时调用隐式同步。

`pnpm db:migrate` 应用迁移；迁移前会确保 `vector` 扩展可用，空库也能直接建出向量表。`pnpm db:reset --yes` 清空显式登记的开发表（包括 `vector_documents`）；`pnpm db:check` 探测连接、pgvector 版本与向量行数。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记。`db:reset` 与 `db:demo` 只允许本机数据库；数据库重置不会删除 `worlds/` 下的历史快照，需要时手动清理。

## 事务边界

LLM 调用不放进数据库事务：先读取状态与 memory，在事务外完成 agent loop，再用行锁与版本号在短事务内应用计划。

快照是提交后的只读投影，不是第二套状态源。快照失败只记录日志，不回滚业务；正式环境通过开关关闭落盘。`game_messages` 的沟通事件同时保存 stage、source、target、visibility；`say` 的 memory 文本按发起者、目标、旁观者生成；`announce` 按发起者与旁观者生成；`whisper` 只生成发起者与目标两人的版本。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[临时测试剧本](test-scenario.md) → 参见：[数据驱动目标](data-driven.md)

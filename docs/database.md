# 数据库

PostgreSQL 是游戏状态的唯一真相。`agent:game` 从数据库读取状态、调用 LLM 与工具、在短事务内应用结果；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

- **身份与对局**：`users` 不进入游戏状态；`games` 是聚合根（`slug`、状态、内容版本、并发版本号）；`game_players` 是座位，v1 一局一个；`actor_controls` 表达玩家接管，不改 actor 本体，释放后同一 actor 恢复 NPC 驱动。
- **世界与场景**：`worlds` 一局一个（`game_id` 唯一），`content_key` 锚定知识库 collection 而非展示名，`actions` 是 world 能力清单；`stages` 按 `ordinal` 保持稳定顺序，`environment` 是 stage 回合覆盖的环境快照，`actions` 声明它作为小 GM 能做什么；`stage_connections` 是同一 world 内的**有向**边，单向出口靠“没有反向边”表达，不做对称推导。`world` 是 game 的运行时子状态而非可复用模板：数据库 `worlds` 存状态，目录 `worlds/` 存导出的开发期快照。
- **角色**：`actors` 依附场景（`stage_id` 非空），有 `is_default_player` 标记与 `actions` 能力清单；`hp` 是可变运行时状态，独立成列，**`hp === 0` 就是死亡**，没有死亡状态列，`death_settled_at` 只是“死亡收尾跑过了吗”的处理标记；`stats` 是恒定属性，`base_body` 是裸体描述，`appearance` 是他人实际所见的快照，`equipment` 是「槽位 → 物品名」索引且每槽至多一件。
- **物品**：`items` 依附角色，`stage_items` 依附场景，两者字段相同、都不记录穿戴状态；动作与穿戴槽按 `name` 定位，因此同一持有者内名字唯一。
- **消息与记忆**：`game_messages` 是公共事件流（`sequence` 追加，带 stage / source / target / visibility），供客户端增量拉取与审计，没有 session 表；`agent_memories` + `agent_memory_messages` 是 actor / stage / world 各自的私有上下文，压缩摘要与被压缩的旧消息都留在 memory 里形成可回述的树。两者不能合并：`mind` 只进 memory，不进公共消息。
- **向量**：`vector_documents` 用 `collection` 隔离世界内容、`embedding_model` 隔离模型；它只装公共知识，不进入私有 memory，也不承载剧情秘密。

## 属性、物品与外观

`Stats` 只有 `maxHp` / `damage` / `block` 参与结算；`strength` / `wisdom` / `agility` 保留在结构与 schema 里但无人读取，写进内容也不影响游戏。六项都是恒定配置，可逐字段相加，`addStats()` 是唯一的加法规则（装备加成也走它）；`hp` 不是属性，扣血只写这一列，上限看 `stats.maxHp`。

物品没有根级 `damage` / `block`，也不记录穿戴状态；五种物品都带完整 `stats`（未用到的为 0），可穿戴性只能看 `kind`，不能看有没有 stats。减伤是目标身上**已穿戴**物品的 `block` 之和，结算时现读。物品 `effect` 是可序列化声明（数据库只存 JSON），执行路由见 → 参见：[Actor 行动与记忆](actor-actions-memory.md)。

`base_body` 是“捏脸完成、还没穿装备”的形态，`appearance` 是其他角色实际看到的样子；NPC 与 stage 的观察只读 `appearance`，seed 里的 `appearance` 是预先写好的推理结果。换装只改槽位索引，外观要显式再推一次，细节见 → 参见：[外观](appearance.md)。

## 开发数据

`seeds/` 是开发期测试内容，不是框架的一部分：剧本、知识库与检索评测集同目录维护，故事文本不写进服务逻辑，结构与内容入口见 → 参见：[数据驱动目标](data-driven.md)，当前剧本的剧情与测试矩阵见 → 参见：[临时测试剧本](test-scenario.md)。

`createGame` 在一个事务里把 `World` 物化成 `worlds` / `stages` / `stage_items` / `actors` / `items` 与各自的 system memory；之后 PostgreSQL 是唯一真相，改内容定义不会回改已有游戏。开场信息只存在于 stage 的 `environment` 与 actor 的 `openingBriefing`，建局不写开场消息；测试用独立的小型世界，不随演示剧本变化。

## 回合与事务

actor、stage、world 三条链路共用同一个节奏：读状态与 memory → 事务外跑 agent loop → 用行锁与版本号在短事务里按计划顺序落账。区别只在计划形状与能力清单，规则见 → 参见：[Actor 行动与记忆](actor-actions-memory.md)、→ 参见：[Stage 小 GM](stage.md)。

不可让渡的边界：LLM 调用不进事务；工具 handler 只暂存计划、不写游戏状态；落账前由服务层重新校验整份计划，任何一条失败就整份丢弃；只读旁路（system prompt 导出、文件快照）失败只告警，不回滚业务；文件快照只能显式导出，不是状态源。行动产生的公共事件与 memory 反馈由动作自己决定可见性，不在这里按动作分叉。

## 死亡阶段

死亡是 `hp === 0` 这个事实，不是状态字段：攻击方只写 `hp`，不断定死亡，也不在攻击事务里做收尾。

`settleDeaths()` 扫出本局「`hp <= 0` 且 `death_settled_at` 为空」的死者各处理一次，彼此独立。每个死者固定两步：先**宣布死亡**（无 LLM）——写公共事件、场景记忆、旁观者记忆与死者自己的记忆，并在同一事务里写标记；再**尽力补一张尸体外观快照**，失败只记进结果，不回退第一步、不重试。所以死亡判定永远不会被 LLM 阻塞。

存活只有一个用途：判断**行动主体**能否自主行动。尸体作为**目标**不受限制——攻击、给予、使用、偷窃都可以指向尸体，这是给复活类玩法留的口子；`hp` 被抬回正数时标记清空，下次死亡重新收尾。批量外观入口用这个标记做幂等：活人重推，未收尾的死者交给死亡阶段，已收尾的跳过。

## 持久化边界

玩法层不写 SQL：动作、物品效果、stage / world 回合、死亡与外观只调用具名函数，表名列名、行锁与「删一行插一行」这类细节集中在 `persistence/`；事务边界在 `apply/`。规则是「玩法层不出现 SQL」，不是「全仓库只有一处碰数据库」——记忆维护与玩家控制也各自读写。

**扣血必须原子**：写 HP 的函数接收 `actorId` 而不是快照，在带行锁的读里取当前值再写。默认效果与词缀会连续结算同一个目标，拿旧快照直接写会互相覆盖；这条不变式放在持久化层，而不是靠每个调用点记得重读。

## 迁移与重置

迁移是唯一建表路径，schema 在服务端代码里、SQL 由 Drizzle Kit 生成（命令见开发文档）。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记；`db:reset` 与 `db:demo` 只允许本机数据库，也不会删除 `worlds/` 下的历史快照。

开发期不做旧数据搬运：迁移只描述目标形状，字段改名或语义变更直接改 schema、生成迁移，然后 `db:reset --yes` + `db:demo` 用当前 seed 重刷，不为没人保留的旧库写一次性 backfill。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[数据驱动目标](data-driven.md)

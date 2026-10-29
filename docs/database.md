# 数据库

PostgreSQL 是游戏状态的唯一真相。`agent:game` 从数据库读取状态、调用 LLM 与工具、在短事务内应用结果；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

- **身份与对局**：`users` 不进入游戏状态；`games` 是聚合根，带状态、world 自己命名的 `outcome`、内容版本与并发版本号；`game_players` 是座位，v1 一局一个；`actor_controls` 表达玩家接管，不改 actor 本体，释放后同一 actor 恢复 NPC 驱动。
- **世界与场景**：`worlds` 一局一个，`content_key` 锚定知识库 collection 而非展示名，`profile` 是世界的自我设定（它是什么、什么算收束）；`stages` 按 `ordinal` 保持稳定顺序，`environment` 是 stage 回合覆盖的环境快照，`anchors` 是同一回合维护的可交互锚点快照；`stage_connections` 是同一 world 内的**有向**边，单向靠「没有反向边」表达，运行时只能把已声明的边从封闭打开，不能新建边。world 是 game 的运行时子状态而非可复用模板：数据库存状态，目录 `worlds/` 存开发期导出的快照。
- **角色**：`actors` 依附场景，带 `is_default_player` 与内容层稳定 `key`；`hp` 是可变运行时状态、独立成列，**`hp === 0` 就是死亡**，没有死亡状态列，`death_settled_at` 只是「死亡收尾跑过了吗」的处理标记；`stats` 恒定，`base_body` 是裸体描述，`equipment` 是「槽位 → 物品名」索引且每槽至多一件。
- **形象**：`actor_presentations` 是「别人此刻看到的样子」的唯一存储位置。每个 actor 同时只有一条 `ended_at is null` 的形象；`appearance` 与稳定的识别特征 `anchor` 都在形象上，换装只改当前形象，伪装 / 变身会开一条新形象并封上旧的。actor 不再持有 `appearance`。
- **物品**：`items` 依附角色，`stage_items` 依附场景，两者字段相同、都不记录穿戴状态；按 `name` 定位，因此同一持有者内名字唯一。`kind` 是自由文本，新增大类不需要迁移。
- **名字信念**：`name_knowledge` 以「观察者 × 形象」为键，存观察者相信的称呼（可为假名、误称）。它不存真名映射，也不做名字抽取；写入只有内容层的开局声明与角色自己的回合。
- **消息与记忆**：`game_messages` 是公共事件流（`sequence` 追加、带可见性），供客户端增量拉取与审计，没有 session 表；`agent_memories` + `agent_memory_messages` 是 actor / stage / world 各自的私有上下文，压缩摘要与被压缩的旧消息都留在 memory 里形成可回述的树。两者不能合并：`mind` 只进 memory。
- **向量**：`vector_documents` 用 `collection` 隔离世界内容、`embedding_model` 隔离模型；只装公共知识，不进私有 memory，也不承载剧情秘密。

## 属性、物品与外观

`Stats` 只有 `maxHp` / `damage` / `block` 参与结算，其余三项保留在结构里但无人读取；六项都恒定可加，`addStats()` 是唯一加法规则。`hp` 不是属性，扣血只写这一列，上限看 `stats.maxHp`。

物品没有根级 `damage` / `block`，可穿戴性只能看 `kind`。`base_body` 是「捏脸完成、还没穿装备」的形态，`appearance` 是其他角色实际看到的样子，存在当前形象上；观察只读当前形象的 `appearance`，换装只改槽位索引，带 `appearanceService` 的入口在事务外补一次外观推理。

→ 参见：[术语表](glossary.md)

→ 参见：[物品](items.md)、[外观](appearance.md)

## 回合与事务

actor、stage、world 三条链路共用同一个节奏：读状态与 memory → 事务外跑 agent loop → 用行锁与版本号在短事务里按计划顺序落账。区别只在计划形状与能力清单。

不可让渡的边界：LLM 调用不进事务；工具 handler 只暂存计划、不写游戏状态；落账前由服务层重新校验整份计划，任何一条失败就整份丢弃；只读旁路失败只告警，不回滚业务。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、[Stage 小 GM](stage.md)

## 死亡阶段

死亡是 `hp === 0` 这个事实，不是状态字段：攻击方只写 `hp`，不断定死亡，也不在攻击事务里做收尾；归零之后的收尾都由死亡阶段按这个事实派生，整局的收尾只由 world 决定。

死亡阶段扫出本局「`hp <= 0` 且 `death_settled_at` 为空」的死者，各处理一次、彼此独立。固定三步，顺序不可换：

1. **宣布死亡**（无 LLM）：写公共事件、场景记忆、旁观者与死者自己的记忆；默认玩家死亡时同时写一条 world 通知。认领是一次 compare-and-set，收尾标记与这些写入同一事务，重复或并发调用只有一个赢家，回滚可整体重试。
2. **尸体外观快照**（LLM，尽力而为）：失败只记进结果，不回退第一步。
3. **掉落材料**（LLM，尽力而为）：读第二步写下的尸体外观与所在场景，把 `material` 写进死者背包、同名合并。排在外观之后才有描写可读；只在新宣布的死者上跑，所以不需要额外幂等标记。

宣布与两次收尾解耦：宣布永不依赖 LLM，后两步失败只是少了快照或掉落。失败不抛出，只进返回值与日志——死亡阶段跑在行动事务之后，不能反过来否定这次行动。

存活只有一个用途：判断**行动主体**能否自主行动；尸体作为**目标**不受限制，这是给复活类玩法留的口子。`hp` 抬回正数时标记清空，下次死亡重新收尾，批量外观入口也用这个标记做幂等。

## 持久化边界

玩法层不写 SQL：动作、物品效果、stage / world 回合、死亡与外观只调用具名函数，表名列名、行锁与「删一行插一行」这类细节集中在 `persistence/`；规则是「玩法层不出现 SQL」，不是「全仓库只有一处碰数据库」。

**扣血必须原子**：写 HP 的函数接收 `actorId` 而不是快照，在带行锁的读里取当前值再写。默认效果与词缀会连续结算同一个目标，拿旧快照写会互相覆盖；这条不变式放在持久化层，不靠调用点自觉。

## 开发数据

`seeds/` 是开发期测试内容，不是框架的一部分：剧本、知识库与检索评测集同目录维护，故事文本不写进服务逻辑。内容包是 `{ world, knowledge }`：建局只消费 `world`，`createGame` 在一个事务里把它物化；`knowledge` 走 rag ingest。之后 PostgreSQL 是唯一真相，改内容定义不会回改已有游戏。

开场信息只存在于 stage 的 `environment` 与 actor 的 `openingBriefing`，建局不写开场消息；测试用独立的小型世界，不随演示剧本变化。

→ 参见：[数据驱动目标](data-driven.md)、[bell-monastery.md](../apps/server/seeds/dark-fantasy/bell-monastery.md)

## 迁移与重置

迁移是唯一建表路径：schema 在服务端代码里，SQL 由 Drizzle Kit 生成（命令见 `package.json`）。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记；`db:reset` 与 `db:demo` 只允许本机数据库，也不删除 `worlds/` 下的历史快照。

开发期不做旧数据搬运：迁移只描述目标形状，字段改名或语义变更直接改 schema、生成迁移，然后用当前 seed 重置重刷。

→ 参见：[开发期 Agent 工作流](debug-workflow.md)

后台作业队列是基础设施状态，不属于游戏聚合。

→ 参见：[后台作业队列](background-jobs.md)

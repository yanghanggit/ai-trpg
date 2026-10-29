# Stage 小 GM

Stage 是活着的场景实体：有自己的 memory、生命周期与仲裁回合，是本场景的小 GM。能力有三项——更新 `environment`、打开本场景通往相邻场景的通道、向 world 发出通知——都由 `stages.actions` 逐场景显式声明。

## 身份

stage 不是 actor，也不是完整 GM：没有 HP、位置、行动槽与自主目标，不能被玩家接管，也不进入 NPC 行动顺序；它只管理自己的场景，只能通过已声明的能力改变场景，或把需要世界裁决的事实报告给 world。

「活着」指它能持续记忆本场景事件、并在被推动时仲裁推理，不表示它会自动运行：当前 stage 回合完全由 agent 显式推动。

## 记忆与可见性

stage 与 actor 共用 `agent_memories` 表，以 `owner_type=stage` 标识。它能看到本场景内所有事件：公开与私密沟通、actor 进出、攻击 / 窃取 / 给予 / 拾取 / 使用、等待、死亡与游戏结束、自己造成的环境变化。

它看不到其他场景的事件，也看不到 actor 的内部 `mind`。看到私密事件不改变 actor 的可见性：其他 actor 是否知道 whisper 仍由原行动范围决定。

## Environment

`environment` 是 stage 当前可变的环境快照，只描述当前可观察的环境、物体、表面状态、光线、气味与氛围。

- 必须是客观的当前快照：不写历史、因果与变化过程，也不写暗示过去的空位、印子或碎屑；
- 必须与当前场景物品一致：还在场景中的物品保留描述，不在场景中的直接省略，也不解释原因；
- 不含角色名称、行动或状态——角色由名单（`## 同场景角色`）、观察与记忆承载，历史在 stage memory 与 `game_messages` 里。写入时会拒绝角色名字与 `@`/`#` 引用；actor 读取时再按观察者脱敏一次：本场角色写成 `@名字`，**不知道名字就用 `#编号`，外观另起一行**——在场者一定看得见对方，不存在「看不清」的兜底。

environment 是拉取模型：stage 更新后不推送，actor 下一次 plan 与 `look_stage` 都读当时的 `stages.environment`。

## 连通性

场景图是一组**有向边**，每条边带通行状态 `open` / `sealed`：`sealed` 表示两侧在剧情上相连、当前不能通过。不做对称推导，双向通行必须显式存在两条边；边的存在性由内容层决定，运行时只能把**本场景已有的出边**从封闭打开。

`open_passage` 是 stage 改变连通性的唯一入口：候选只能是尚未开启的出边，一次回合最多打开一条。它改变通行状态、写 `passage_change` 公共事件与 stage 记忆，**不通知 world**、不修改对面场景。actor 的可去场景与 `move` 校验都只读开启的边，所以通道打开后下一次观察即可见。

→ 参见：[数据库](database.md)

## 回合

stage 回合与 actor 回合平行，但不共享 actor plan：读状态与 stage memory → 组装环境、同场景角色、场景物品、可去场景、未开启通道与场景事件 → agent loop 推理 → 用 `open_passage` / `notify_world` 加入计划 → 用 `submit_environment` 提交 → 短事务内校验、按序执行、递增版本、写公共事件。

两个 GM 都是**写入即快照**：每加入一个动作就刷新一次计划快照，模型忘记调用终止工具或轮次用尽时，已暂存的动作仍会落账。轮数上限按「定位 + 全部写动作 + 一次纠偏」配置；回合结果里的 `loopSuccess` 只表示模型是否显式提交过计划。

`StagePlan` 与 `ActorPlan` / `WorldPlan` 同构，都是 `{ actions: [...] }` 的有序列表：environment 至多一条、通道至多一条、通知至多 `MAX_STAGE_NOTIFICATIONS_PER_TURN` 条，开始写库前全部校验完。额度只约束会写库的动作，且写进 stage 的任务文本，模型不必靠试错发现上限。

每个场景都必须声明 `submit_environment`，内容校验会拒绝缺少它的内容；`open_passage` / `notify_world` 按设定额外声明。

`notify_world` 写入的是 **stage 报告**，不是世界事实，也不是系统指令：它进入 world memory，由 world 回合裁决。stage 不应直接结束游戏，也不应修改其他场景。通道与通知是两件事：开门只改本场景出边，不向 world 报告；只有跨场景 / 世界级后果才报告，判断必须来自本场景已有的信息。

## 事件

刷新 environment 产生 `environment_change` 公共事件（`stage_id` 指向该场景、`source_actor_id` 为空），打开通道产生 `passage_change`；两者都进 stage memory 与公共事件流，但不写 actor memory——actor 下一次 plan 读当前 environment、可去场景也自然更新。

`passage_change` 只写起点场景的 stage memory，对面场景与 world 都不因此获得记忆。`notify_world` 不产生公共事件，只写 world memory 并在 stage memory 留一条通知记录；world 用 `notify_stage` 下发裁决，stage 下一回合读取 directive。actor 行动产生的场景事件同样进入 stage memory，移动分别写起点与终点两个 stage。

## World 与 CLI

`agent:game stage` 推动一个 stage 回合（`--all` 按顺序推进全部），不调用 actor loop，也不自动跟随 actor 行动；`agent:game world` 推动 world 回合，读取 stage 通知并裁决。

只有 world 能 `end_game`，`outcome` 是它自己命名的短标签，框架不枚举；只在世界设定与全局规则里的收束条件已由不可逆事实满足时使用。world 的只读工具不限次数，写动作一轮最多 `MAX_WORLD_ACTIONS_PER_TURN` 个，上限与提交节奏同样写进任务文本。

world 回合允许没有动作：显式提交空计划即表示本轮无世界级变更，与「没提交计划」相区分；模型不必为了走完流程编造通知。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[Agent 探针](probe.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

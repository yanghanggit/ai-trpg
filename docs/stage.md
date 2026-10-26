# Stage 小 GM

Stage 是活着的场景实体：有自己的 memory、生命周期与仲裁回合，是本场景的小 GM。能力有三项：更新 `environment`、打开本场景通往相邻场景的通道、向 world 发出通知；都由 `stages.actions` 逐场景显式声明。

## 身份

stage 不是 actor，也不是完整 GM。

- 它没有 HP、位置、行动槽或自主目标；
- 不能被玩家接管，不能进入 NPC 行动顺序；
- 它只管理自己的场景，不能替 actor 行动；
- 它只能通过当前允许的 stage 能力改变场景本身（环境、本场景出边的通行状态），或通过 `notify_world` 向 world 报告需要世界裁决的事实。

“活着”指它能持续记忆本场景发生的事件，并在被推动时进行仲裁推理；不表示它会自动运行。当前 stage 回合完全由 agent 显式推动，未来才可能接入调度。

## 记忆与可见性

stage 使用与 actor 相同的 `agent_memories` 表，以 `owner_type=stage`、`owner_id=stage.id` 标识。`agent_memory_messages` 保存它的 system prompt、场景事件与自己的仲裁结果。

stage 能看到本场景内所有事件，包括：

- 公开与私密沟通；
- actor 进入与离开；
- 攻击、窃取、给予、拾取与使用道具；
- 等待、死亡与游戏结束；默认玩家角色死亡由系统终结，不经过 stage 的结束动作；
- 自己造成的环境变化。

它看不到其他场景的事件，也看不到 actor 的内部 `mind`。stage 能看到私密事件，不改变 actor 的可见性：其他 actor 是否知道 whisper 仍由原行动范围决定。

## Environment

`environment` 是 stage 当前可变的环境快照，对应 `stages.environment`。

- 只描述当前可观察的环境、物体、表面状态、光线、气味与氛围；
- 必须是客观的当前快照，不写历史、因果、变化过程，也不写暗示过去的空位、印子、痕迹或碎屑；
- 必须与当前场景物品一致：仍在场景中的物品要保留描述，物品不在场景中时直接省略，不解释它为什么不在；
- 不包含角色名称、角色行动或角色状态；
- 不承担事件历史，历史在 stage memory 与 `game_messages`；
- seed 提供初始值，运行时由 stage 回合覆盖。

environment 是拉取模型：stage 更新后不向 actor 推送；actor 下一次 plan 的当前环境输入，以及 `look_stage` 读取，使用当时的 `stages.environment`。

## 连通性

场景图是一组**有向边**，每条边带通行状态 `open` / `sealed`：`sealed` 表示两侧在剧情上相连、当前不能通过。相邻关系不做对称推导，双向通行必须显式存在两条边；边的存在性由内容层决定，运行时只能打开**本场景已有的出边**，不能新建边。

`open_passage` 是 stage 改变连通性的唯一入口：候选只能是本场景尚未开启的出边，一次回合最多打开一条。它改变 `stage_connections.passage`、写 `passage_change` 公共事件与 stage 记忆，**不通知 world**、不修改对面场景。actor 的可去场景与 `move` 校验都只读 `open` 边，所以通道打开后下一次观察即可见。

每个场景都必须声明 `submit_environment`，内容校验会拒绝缺少它的内容；场景可以按设定额外声明 `open_passage` / `notify_world`。写入动作加入计划时即刷新快照，所以模型即使忘记调用终止工具，本轮已经加入的动作也不会丢；`submit_environment` 只额外负责补上或替换 environment。

## 回合

stage 回合与 actor 回合平行，但不共享 actor plan：

1. 读取当前游戏状态、stage 状态与 stage memory；
2. 组装当前环境、同场景角色、场景物品、可去场景、未开启的通道与场景事件；
3. 通过 agent loop 读取本场景，推理环境是否变化、是否要打开通道、是否需要通知 world；
4. 用 `open_passage` / `notify_world` 把动作加入本轮计划；
5. 用 `submit_environment` 提交计划（environment 可省略，也可以只提交已加入的其他动作）；计划至少要有一条动作；
6. 在短事务中校验、按计划顺序执行、递增 game version、写公共事件。

两个 GM 都是**写入即快照**：每加入一个动作就刷新一次计划快照，模型忘记调用终止工具或轮次用尽时，已暂存的动作仍会落账。轮数上限按「定位 + 全部写动作 + 一次纠偏」配置，保证按任务文本正常规划时结构上装得下；回合结果里的 `loopSuccess` 只表示模型是否显式提交过计划。

`StagePlan` 与 `ActorPlan` / `WorldPlan` 同构，都是 `{ actions: [...] }` 的有序列表：`{ kind: "submit_environment", environment }`、`{ kind: "open_passage", targetStageName }` 或 `{ kind: "notify_world", notification }`。environment 至多一条、通道至多一条，通知至多 `MAX_STAGE_NOTIFICATIONS_PER_TURN` 条；开始写库前全部校验完。

额度只约束**会写库的动作**：只读工具（`look_stage` / `observe_actor`）可以多次调用、不占额度。额度会写进 stage 的任务文本，模型不必靠试错发现上限。

工具 handler 不写数据库；LLM 调用在事务外完成。

`notify_world` 写入的是 **stage 报告**，不是世界事实，也不是系统指令。它进入 world memory，由 world 回合裁决。stage 不应直接结束游戏，也不应直接修改其他场景。

通道与通知是两件事：开门只改变本场景出边的通行状态，不向 world 报告；只有跨场景/世界级后果才报告。判断依据必须来自本场景已有的信息，仅凭外观或相似形状不能推断出通道或隐藏机制。

## 事件

stage 更新产生 `environment_change` 公共事件，`stage_id` 指向该场景，`source_actor_id` 为空。事件进入 stage memory 与公共事件流，但不写 actor memory；actor 下一次 plan 通过当前 `stages.environment` 获取变化。

通道打开产生 `passage_change` 公共事件，只写起点场景的 stage memory；对面场景与 world 都不因此获得记忆，actor 的可去方向在下一次读取时自然更新。

`notify_world` 不产生公共事件；它写 world memory，并在 stage memory 留一条通知记录。world 收到后可以 `notify_stage` 下发裁决，stage 下一回合读取 world directive。

actor 行动产生的场景事件也进入 stage memory；移动会分别写入起点与终点两个 stage。环境更新本身是一个 stage 行动结果，不依赖 actor 行动。

## CLI

`agent:game stage --game <gameId|slug> --stage <stageId|stageName>` 推动一个 stage 回合；`--all` 按当前 stage 顺序推动全部场景。它不调用 actor loop，也不自动跟随 actor 行动。

`agent:game world --game <gameId|slug>` 推动 world 回合，读取 stage 通知并执行 world 裁决；只有 world 能 `end_game`。world 的只读工具（`look_stage`）同样不限次数，写动作（`notify_stage` / `end_game`）一轮最多 `MAX_WORLD_ACTIONS_PER_TURN` 个，足够“通知两个场景并在同一轮收束”；动作上限与提交节奏同样写进任务文本。

→ 参见：[数据库](database.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[Agent 探针](probe.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

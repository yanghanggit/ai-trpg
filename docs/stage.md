# Stage 小 GM

Stage 是活着的场景实体：有自己的 memory、生命周期与仲裁回合，是本场景的小 GM。当前它有两项能力：更新 `environment`，以及向 world 发出通知；两者都由 `stages.actions` 显式声明。

## 身份

stage 不是 actor，也不是完整 GM。

- 它没有 HP、位置、行动槽或自主目标；
- 不能被玩家接管，不能进入 NPC 行动顺序；
- 它只管理自己的场景，不能替 actor 行动；
- 它只能通过当前允许的 stage 能力改变场景本身，或通过 `notify_world` 向 world 报告需要世界裁决的事实。

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

## 回合

stage 回合与 actor 回合平行，但不共享 actor plan：

1. 读取当前游戏状态、stage 状态与 stage memory；
2. 组装当前环境、同场景角色、场景物品、可去场景与场景事件；
3. 通过 agent loop 读取本场景，推理环境是否变化、是否需要通知 world；
4. 用 `notify_world` 把场景报告加入本轮计划；
5. 以 `submit_environment` 提交计划；`environment` 可省略，但计划必须包含 environment 或至少一条通知；
6. 在短事务中校验、更新 `stages.environment`、写 world/stage memory、递增 game version、写公共事件。

工具只读部分包括 `look_stage` 与 `observe_actor`，且只允许查看本场景；`notify_world` 把报告写入本轮计划，`submit_environment` 是终止工具。工具 handler 不写数据库；LLM 调用在事务外完成。

`notify_world` 写入的是 **stage 报告**，不是世界事实，也不是系统指令。它进入 world memory，由 world 回合裁决。stage 不应直接结束游戏，也不应直接修改其他场景。

通知只针对可能改变世界级状态的行动；只有场景已有信息表明 `targetDetail` 是功能部位（如锁孔、门闩、机关）时才考虑通知。装饰、铭文、表面纹样或物品外观相似都不构成机关，不能据此推测隐藏锁扣。

## 事件

stage 更新产生 `environment_change` 公共事件，`stage_id` 指向该场景，`source_actor_id` 为空。事件进入 stage memory 与公共事件流，但不写 actor memory；actor 下一次 plan 通过当前 `stages.environment` 获取变化。

`notify_world` 不产生公共事件；它写 world memory，并在 stage memory 留一条通知记录。world 收到后可以 `notify_stage` 下发裁决，stage 下一回合读取 world directive。

actor 行动产生的场景事件也进入 stage memory；移动会分别写入起点与终点两个 stage。环境更新本身是一个 stage 行动结果，不依赖 actor 行动。

## CLI

`agent:game stage --game <gameId|slug> --stage <stageId|stageName>` 推动一个 stage 回合；`--all` 按当前 stage 顺序推动全部场景。它不调用 actor loop，也不自动跟随 actor 行动。

`agent:game world --game <gameId|slug>` 推动 world 回合，读取 stage 通知并执行 world 裁决；只有 world 能 `end_game`。

→ 参见：[数据库](database.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[Agent 探针](probe.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

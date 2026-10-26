# Agent 探针

探针是对 agent 实体的一次只读记忆检查：只读取目标的 system prompt 与 memory，临时追加一个问题，调用一次 LLM 并返回回答；不进入行动计划，不写入 memory，不改变游戏状态，也不注入当前 observation。

## 用途

- 检查关键行动结果是否真的写入了 memory；
- 检查 actor 是否从自己的行动结果中知道物品归属变化；
- 检查 stage 是否从事件记忆里知道场景物品变化；
- 检查 private 事件是否进入正确的 memory；
- 在不产生副作用、不补充当前 observation 的情况下，观察目标仅凭记忆如何理解状态。

探针不是行动，也不是对话事件。问 actor“你身上还有什么”不会让 actor 移动、攻击、拾取或提交计划。

## 目标

当前支持 actor 与 stage。

actor 探针只使用 actor 的 system prompt 与 actor memory；不注入当前场景、自身物品或 observation。stage 探针只使用 stage 的 system prompt 与 stage memory；不注入当前 environment、角色或场景物品。

这样，探针回答是否正确，直接取决于正常 agent loop 是否把关键行动结果写进了 memory。若结果没有进入 memory，探针就应当无法回答，而不是被当前状态补齐。

stage 探针能看到本场景的 private 事件；这是 stage memory 的既有可见性，不改变 actor 的可见范围。

world 目前没有自己的 memory 与 system prompt，因此暂不作为探针目标；等 world 成为正式 agent 实体后再接入。

## 无副作用

探针使用 memory 副本，不追加真实 memory；不写 `game_messages`，不递增 game version，不调用 actor/stage 的 apply 层，不修改 environment、物品、位置或 HP。

LLM 通讯留痕只进入开发期日志，不属于游戏 memory。

## CLI

`agent-game probe --game <gameId|slug> --actor <actorId|actorName> --message <text>`

`agent-game probe --game <gameId|slug> --stage <stageId|stageName> --message <text>`

输出包含目标类型、目标名称、回答与 finish reason；不返回可变游戏状态。

→ 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[Stage 小 GM](stage.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md)

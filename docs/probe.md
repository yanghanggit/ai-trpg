# Agent 探针

探针是对 agent 实体的一次只读记忆检查：读取目标的 system prompt 与 memory，临时追加一个问题，调用一次 LLM 并返回回答；不进入行动计划，不写入 memory，不改变游戏状态，也不注入当前 observation。

它回答的是「这条信息真的进 memory 了吗」：检查关键行动结果、物品归属变化、private 事件是否写进了正确的 memory，以及目标仅凭记忆如何理解状态。探针不是行动，也不是对话事件——问 actor「你身上还有什么」不会让他移动、攻击或提交计划。

## 目标

支持 actor 与 stage。actor 探针只用 actor 的 system prompt 与 memory，不注入当前场景、自身物品或 observation；stage 探针只用 stage 的 system prompt 与 memory，不注入 environment、角色或场景物品。

这样探针答不上来就是正常信号：若结果没有进入 memory，探针应当无法回答，而不是被当前状态补齐。stage 探针能看到本场景的 private 事件，这是 stage memory 的既有可见性，不改变 actor 的可见范围。

world 目前没有自己的 memory 与 system prompt，因此暂不作为探针目标；等 world 成为正式 agent 实体后再接入。

## 无副作用

探针使用 memory 副本，不追加真实 memory，不写 `game_messages`，不递增 game version，不调用 apply 层，不修改 environment、物品、位置或 HP。探针的 LLM 通讯只进过程轨迹，不属于游戏 memory。

## CLI

`agent:game probe` 用 `--actor` 或 `--stage` 指定目标，`--message` 给问题；输出包含目标类型、目标名称、回答与 finish reason，不返回可变游戏状态。

→ 参见：[开发期 Agent 工作流](debug-workflow.md)、[Stage 小 GM](stage.md)、[Actor 行动与记忆](actor-actions-memory.md)

# Agent 探针

探针是对 agent 实体的一次只读记忆检查：读取目标的 system prompt 与 memory，临时追加一句话，调用一次 LLM 并返回回答；不进入行动计划，不写入 memory，不改变游戏状态，也不注入当前 observation。追加的那句话可以是问题，也可以是一句判断——探针看的是目标会怎么回应，不是它肯不肯答题。

它回答的是「这条信息真的进 memory 了吗」：检查关键行动结果、道具归属变化、private 事件是否写进了正确的 memory，以及目标仅凭记忆如何理解状态。探针不是行动，也不是对话事件——问 actor「你身上还有什么」不会让他移动、攻击或提交计划。

## 目标

三类记忆实体都能问：world、stage、actor。目标是「记忆所有者」而不是另一种实体，所以记忆读取与探针用同一套门牌——问谁就是读谁，解析只在 `resolveMemoryOwner` 一处。

目标决定注入什么，除此之外没有别的差别：actor 探针只带 actor 的 system prompt 与 memory，不注入当前舞台、自身道具或 observation；stage 探针不注入 environment、角色或舞台道具；world 探针只带世界宪法与它自己的记忆，不注入任何舞台。

这样探针答不上来就是正常信号：若结果没有进入 memory，探针应当无法回答，而不是被当前状态补齐。stage 探针能看到本舞台的 private 事件，这是 stage memory 的既有可见性，不改变 actor 的可见范围；world 探针能看到跨舞台的事实，那是世界自己的全知范围。

## 无副作用

探针使用 memory 副本，不追加真实 memory，不写 `game_messages`，不递增 game version，不调用结算层，不修改 environment、道具、位置或 HP。探针的 LLM 通讯只进过程轨迹，不属于游戏 memory。

## 归属

探针是旁路的只读形态：与外观、尸体外观、掉落一样，它借目标自己的记忆、沿用目标的宪法，不新建实体也不写记忆。不同之处在产物：只回调用方，推理是一次 `complete`、不带工具，因此不经过 `agents/bypass/` 的工具回路。分类见 [Agent 与工具](agents.md)。

## CLI

`agent:game probe` 用 `--actor`、`--stage` 或 `--world` 指定目标，`--message` 给那句话；输出包含目标类型、目标名称、回答与 finish reason，不返回可变游戏状态。HTTP 面同样按 owner 门牌取目标，与 `GET /games/{game}/memory` 一致。

→ 参见：[开发期 Agent 工作流](debug-workflow.md)、[舞台](stage.md)、[Actor 行动与记忆](actor-actions-memory.md)、[Agent 与工具](agents.md)

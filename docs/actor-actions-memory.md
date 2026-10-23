# Actor 行动与记忆

本文定义 actor 行动与记忆的目标原则。当前实现仍处在从原始 loop memory 迁移到压缩 action memory 的阶段；迁移完成后以代码为准。

## 第一级概念

`actor` 是第一级实体。NPC 与玩家不是两种 actor 表，而是同一个 actor 的两种控制者。NPC 由 agent loop 驱动，玩家通过接管关系直接提交行动；actor 的身份、场景归属、物品、状态与 memory 不因控制者改变。

actor 目前有两个运行时容器：`items` 道具队列与 `statusEffects` 状态队列。状态队列为 buff/debuff 预留，当前不驱动系统规则；鼠王的沉睡属于角色 profile，由 LLM 根据场景记忆判断是否苏醒。

玩家接管通过独立的控制关系表达，不把控制字段塞回 actor 本体。释放接管后，同一个 actor 恢复 NPC 驱动，继续使用原 memory。

## 两条入口，一个落库点

NPC 路径是环境观察、agent loop、计划与工具调用、提交计划，然后进入统一行动应用层。Player 路径是直接提交行动，跳过计划和 LLM，同样进入统一行动应用层。

两条路径的差别只在行动如何产生；状态校验、版本递增、公共消息、目标与旁观者反馈、actor memory 写入必须共用同一套应用逻辑。

## 三层数据

| 层 | 内容 | 用途 |
| --- | --- | --- |
| actor 长期 memory | system prompt + 每条行动事实 | 下一次 LLM request 的稳定上下文 |
| action context dump | 本次 agent loop 的完整消息 | 审计、反查、快照观测 |
| `game_messages` | 公共事件流 | 客户端增量拉取与场景事件 |

三层不能互相替代。长期 memory 不是公共消息；context dump 不是下一轮 prompt；公共消息也不承担 agent 私有记忆。

## 行动事实

每次行动只落一条 action memory，内容是：

- 做了什么；
- 为什么这么做；
- 行动结果。

行动事实可以有结构化元数据，但顶层长期记忆保持为一条可读事实，不保存逐轮对话。NPC 的“为什么”来自计划中的内心理由；Player 的直接提交可以带理由，没有理由时明确标记为玩家直接提交。

actor 的长期 memory 由 system prompt 与这些行动事实组成。任务提示词、环境观察、工具调用与工具结果不单独成为长期记忆条目。

## Context dump 的边界

每条 action memory 附加一份 context dump，只包含**产生这条行动的那一次 agent loop**：

- 本次环境观察；
- 本次任务提示词；
- 本次 AI tool_calls；
- 本次工具结果；
- 多轮 loop 的中间消息；
- 终止工具的提交与结果。

不包含 system prompt、之前回合的行动事实、之前回合的 loop 轨迹，也不包含其他 actor 的 memory。

context dump 是审计旁路。下一次 LLM request 只使用长期 memory 中的 system prompt 与行动事实，再加上当前回合的环境与任务提示词；不会自动把历史 context dump 塞回 prompt。当前不提供“让 agent 主动回读完整 context”的工具。

## 任务提示词

任务提示词属于单次 loop 的临时输入，不单独进入长期 memory。它随本次 context dump 保留，供事后还原当时的决策条件；下一轮 NPC 会重新生成当前环境与任务提示词。

## 工具

NPC 工具分为 GET、intent 与终止工具。`look_stage`、`get_stats`、`get_items` 是只读 GET，可多次调用并立即返回结果；是否一次返回多个调用或分多轮调用由 LLM 决定，循环层按返回顺序串行执行。`communicate` 暂存一次沟通行动；`move` 暂存一次移动或等待行动；`interact` 暂存一次交互，参数为分支（`purpose`）+ 道具（`itemNames` / `itemName`）+ 对象（`targetActorName` / `targetStageName`）；`submit_plan` 是终止工具，只提交已暂存计划。工具 handler 不写游戏状态。

计划由有序 intent 组成，最多一个沟通 intent 与一个行动类 intent。当前行动类包含移动与交互；移动内部有 `move`/`wait`，交互与移动占用同一个行动槽并互斥；沟通类可以与任意行动类共存。两个 intent 按工具调用顺序应用，先移动后沟通、先沟通后移动、先移动后交互与先交互后移动是不同结果。

每个成功应用的 intent 都产生一条公共事件；`wait` 产生 `kind=wait` 的公开事件，交互产生 `kind=<purpose.kind>` 的公开事件；事件范围由交互分支的 `broadcast` 决定。同场景公开分支会向其他 actor 写入可见行动观察。`wait` 只是不改变场景状态。actor 的 `death` 为 true 时不能进入下一次 loop；伤害使目标 HP 归零时同时写入 `death=true`。工具调用轨迹属于本次 loop，进入 context dump，不进入长期 memory 的顶层事实。行动的应用发生在 loop 结束后，由统一行动应用层校验并按顺序提交。

## 沟通动作

| 动作 | 目标 | 听见范围 | 公共可见性 |
| --- | --- | --- | --- |
| `say` | 必须指定单个目标 | 发起者、目标、同场景其他 actor | `stage` |
| `whisper` | 必须指定单个目标 | 只有发起者与目标 | `private` |
| `announce` | 无目标 | 同场景所有 actor | `stage` |

`say` 是有目标公开：目标与旁观者都得到带双方身份的观察文本。`whisper` 只有双方进入 memory。`announce` 没有目标，按场景广播。

受话者与旁观者不写“为什么”，只写发生了什么与当时的场景上下文；行动发起者才写行动事实与理由。

## 交互动作

顶层行动只有三类：沟通、移动、交互。`interact` 与 `communicate`、`move` 平级；它的语义固定为三段：想达成什么结果（`InteractPurpose`）、搭配什么道具（`itemNames` / `itemName`）、作用于谁（`targetActorName` / `targetStageName`）。

`damage` / `steal` / `give` / `pickup` / `use` 是**交互分支**，定义在 `InteractBranch` 目录里；分支自带 `broadcast` 与 `resolution`，因此 `steal` 为 private 是分支属性。攻击就是 `damage` 分支。`get_actor` 可查看同场景目标的 stats、状态与背包。

互斥只发生在“计划槽位”层面：沟通占一个槽，移动与交互共享同一个行动槽，一轮内移动和交互只能选一个，但语义上三者平级。

一次交互需要 `InteractPurpose` 和选中的 `Item[]`。`damage` 分支支持 `{ kind: "damage", targetActorName }`，可搭配武器道具；`use` 分支支持 `{ kind: "use", itemName, targetActorName | targetStageName }`。伤害为 `max(0, 攻击者 attack + 所选武器 damage - 目标 defense)`；空手时不加武器 damage，目标 defense 是唯一 block，物品 block 不参与当前伤害。武器是 `Item` 的子类型，`count` 固定为 1，额外携带 `damage` 与 `block`；`block` 当前只存储，供未来防御/装备规则使用。目标 HP 归零时同时写 `death=true`，actor 仍留在场景中，但不再执行 NPC loop，也不能再被攻击。

交互产生 `kind=<purpose.kind>` 的公共事件（`damage` / `steal` / `give` / `pickup` / `use`）；广播范围取分支的 `broadcast`。记忆按视角生成：发起者收到第一人称行动结果，目标收到“你被攻击/你剩余 HP”，旁观者收到第三人称战斗观察；三者描述同一事实但格式不同。不做跨场景信息广播。未来 `resolution=llm` 的分支必须在数据库事务外完成 GM 判定，再由统一应用层写入结果。

## 事务边界

LLM 与 agent loop 在数据库事务外完成。行动应用层在短事务中锁定 game、校验当前状态、应用变更、递增版本、写公共消息与 memory；不持有数据库锁等待模型返回。

同一 actor 的行动串行化；被玩家接管的 actor 由玩家入口提交，NPC 批量推进时跳过，不并发驱动同一个 actor。

## 快照

开发期快照导出 actor 的 system prompt、行动事实与 context dump，供人工与 agent 观察。快照是只读投影，不是状态源；正式环境不把私有 memory 暴露给客户端。

## 不做的事

- 不把 NPC 做成独立的一级表；
- 不把 context dump 自动塞回下一轮 prompt；
- 不让工具 handler 直接改数据库；
- 不把公共 `game_messages` 当作 agent 私有 memory；
- 不在长期 memory 中保留每轮任务提示词与完整工具轨迹；
- 不在同一 actor 被玩家接管时继续运行 NPC loop。

→ 参见：[数据库](database.md) → 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[LLM 基础组件](llm.md)

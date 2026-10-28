# Actor 行动与记忆

## 第一级概念

`actor` 是第一级实体。NPC 与玩家不是两张表，而是同一个 actor 的两种控制者：NPC 由 agent loop 驱动，玩家通过接管关系直接提交行动。身份、场景归属、物品、状态与 memory 不因控制者改变；释放接管后，同一 actor 恢复 NPC 驱动并继续使用原 memory。

actor 只有一个运行时容器：`items` 道具队列。沉睡这类开局状态属于 `openingBriefing`，由 LLM 根据场景记忆判断何时解除，不是独立状态机。

## 两条入口，一个落库点

NPC 路径是环境观察 → agent loop → 计划与工具调用 → 提交计划 → 统一行动应用层；玩家路径直接提交行动，跳过计划与 LLM，同样进入统一应用层。差别只在行动如何产生；校验、版本递增、公共消息、目标与旁观者反馈、actor memory 写入共用同一套逻辑。

## 行动事实

记忆分三层，不能互相替代：actor 长期 memory 是下一次 LLM request 的稳定上下文；action context dump 是本次 loop 的完整消息，只用于审计与反查；`game_messages` 是公共事件流，供客户端增量拉取。长期 memory 不是公共消息，context dump 不是下一轮 prompt，公共消息也不承担私有记忆。

每次行动只落一条 action memory：做了什么、为什么、结果。可以有结构化元数据，但顶层长期记忆保持为一条可读事实，不保存逐轮对话。NPC 的「为什么」来自计划里的内心理由；玩家直接提交可以带理由，没有时明确标记为玩家直接提交。

长期 memory 由 system prompt、可选的 `openingBriefing` 与行动事实组成；compact 后 `[1..]` 收敛为一条 human summary。任务提示词、环境观察、工具调用与结果不单独成为长期记忆条目。

## Context dump

每条 action memory 附加一份 context dump，只包含产生该行动的那一次 loop：环境观察、任务提示词、tool_calls 与工具结果、多轮 loop 的中间消息，以及终止工具的提交与结果。它不含 system prompt、历史行动事实、历史 loop 或其他 actor 的 memory。

它是审计旁路：下一轮只用长期 memory 加当轮环境与任务提示词，不会把历史 dump 塞回 prompt；当前也没有「主动回读完整 context」的工具。

## 开局简报

`openingBriefing` 是内容层给一个 actor 的本局私有简报（位于 `World.actors[]`，不是数据库字段），可含目标、任务、初始处境、约束与已知信息。它在建局时注入一次并进入长期 memory，因此后续仍能读到；不是单轮任务提示词，也不是公共消息。没有简报的 actor 不产生这条消息。

## 记忆压缩

actor、stage、world 的 memory 都遵循同一闭环：`[0]` 是 system，`[1]` 是 human，之后是运行历史。compact 把 `[1..]` 压成一条新的 human summary，memory 回到 system + summary；system 永远不动，不生成第二套状态。

摘要必须保留仍然有效的身份、目标、底线、关系、关键事实与未解决冲突。新 summary 归档被压缩的旧消息、条数与时间，也记录 `contextUsageRatio`；旧 summary 自身带更早的归档，所以连续 compact 形成可递归展开的树。

compact 只能手动触发：在事务外调用 LLM，在完整 turn 边界落账，LLM 失败或记忆在压缩期间变化时不改数据库。比例取自最近一条 AI 消息的 metadata，并在每次追加 AI 消息时写回。

## 任务提示词

任务提示词属于单次 loop 的临时输入，不进入长期 memory；它随 context dump 保留，供事后还原当时的决策条件，下一轮重新生成。

## 工具

只读工具可多次调用、立即返回、不占动作额度：`look_stage` 看当前场景，`get_self` 返回自己的完整信息，`observe_actor` 只返回同场景目标携带的物品（含物品级数值与是否穿戴），不暴露对方的角色属性与生命。`query` 检索公共知识，参数是关键词而非整句提问。

→ 参见：[公共知识检索](rag.md)

动作工具共十二个，彼此平级，每个工具的参数就是该动作的全部输入，没有中间分类或 `purpose` 参数，也不写游戏状态；是否一次返回多个调用由 LLM 决定，循环层按顺序串行执行。`submit_plan` 是终止工具，只提交已暂存计划。

计划是有序动作列表，最多两条（`MAX_ACTIONS_PER_TURN`）；不做分类互斥，只限制条数。「通常一次沟通加一个其他动作」由提示词约定，超限时 handler 立即报错。两个动作按调用顺序应用，先移动后说话与先说话后移动结果不同。

每个成功应用的动作产生一条公共事件，`kind` 就是动作名，可见范围由动作决定（`whisper` 与 `steal` 为 private，其余为 stage）。同场景公开动作会向其他 actor 写入可见行动观察；`wait` 不改变场景状态。工具调用轨迹属于本次 loop，只进 context dump。

`hp` 为 0 的 actor 不能进入下一次 loop；伤害只写 `hp`，不判定死亡，收尾统一由死亡阶段完成，失败不进 actor 记忆。

→ 参见：[数据库](database.md)

## 沟通动作

| 动作 | 目标 | 听见范围 | 公共可见性 |
| --- | --- | --- | --- |
| `say` | 必须指定单个目标 | 发起者、目标、同场景其他 actor | stage |
| `whisper` | 必须指定单个目标 | 只有发起者与目标 | private |
| `announce` | 无目标 | 同场景所有 actor | stage |

`say` 的观察文本带双方身份，目标与旁观者都能读到；`whisper` 只有双方进入 memory；`announce` 按场景广播。受话者与旁观者不写「为什么」，只写发生了什么与当时的场景上下文；只有发起者写行动事实与理由。

## 移动与战斗的信息不对称

`move` 是唯一同时触及两个场景的动作，记忆刻意保持不对称：移动者本人知道从哪到哪；旧场景记忆只写「他离开了」，新场景记忆只写「他进入了」，两边其他 actor 各得到离开与进入观察。起点与终点的组合不写给任何旁观者，移动者也不会收到自己的离开 / 进入观察。

战斗按「谁的伤口」分流：只有受害者自己的反馈带剩余 HP；发起者与同场景旁观者只知道这一下造成多少伤害、对方是否倒下。完整数值只写进 `game_messages` 与舞台记忆。

## 物品与能力

`attack` 与 `use` 只是 dispatcher：选择物品、校验目标、调用 `item.effect`，具体效果由 `effect.type` 路由到的 handler 承担，每个动作最多引用一件物品。

- `damage`：固定公式 `max(0, 攻击方总 damage - 目标总 block)`，两侧都用 `addStats()`，目标装备在结算时现读；有 `affixes` 时默认效果跑完再补一次事务外 LLM 效果。
- `event`：只写「使用了某物」的事件，后果交给 stage / world。

物品必须显式声明 effect，没有默认效果；空手攻击用系统 `damage`，`attack` 的武器固定来自 `equipment.weapon` 且必须声明 `damage`，否则按空手结算。新增 `heal`、`open` 等效果只注册新 handler，不在 `attack` / `use` 里写分支。

`equip` / `unequip` 只改穿戴索引：物品行不动，也不触发外观推理。

目标不需要存活：规则全局只有一条——行动者自己必须活着，尸体可以被说话、攻击、给予、使用与偷窃。这是给复活类玩法留的口子，没有第二套过滤。

→ 参见：[物品](items.md) → 参见：[外观](appearance.md)

## 事务边界

LLM 与 agent loop 在数据库事务外完成。行动应用层在短事务中锁定 game、校验当前状态、应用变更、递增版本、写公共消息与 memory，不持锁等待模型返回。

同一 actor 的行动串行化；被玩家接管的 actor 由玩家入口提交，NPC 批量推进时跳过。

## 快照

开发期快照导出 actor 的 system prompt、行动事实与 context dump，供人工与 agent 观察。快照是只读投影，不是状态源；正式环境不把私有 memory 暴露给客户端。

→ 参见：[开发期 Agent 工作流](debug-workflow.md)、→ 参见：[LLM 基础组件](llm.md)

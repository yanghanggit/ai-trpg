# Actor 行动与记忆

## 第一级概念

`actor` 是第一级实体。NPC 与玩家不是两张表，而是同一个 actor 的两种控制者：NPC 由 agent loop 驱动，玩家通过接管关系直接提交行动。身份、场景归属、物品、状态与 memory 不因控制者改变；释放接管后，同一 actor 恢复 NPC 驱动并继续使用原 memory。

actor 只有一个运行时容器：`items` 道具队列。沉睡这类开局状态属于 `openingBriefing`，由 LLM 根据场景记忆判断何时解除，不是独立状态机。

## 两条入口，一个落库点

NPC 路径是环境观察 → agent loop → 计划与工具调用 → 提交计划 → 统一行动应用层。玩家路径直接提交行动，跳过计划与 LLM，同样进入统一应用层。差别只在行动如何产生；校验、版本递增、公共消息、目标与旁观者反馈、actor memory 写入必须共用同一套逻辑。

## 三层数据

| 层 | 内容 | 用途 |
| --- | --- | --- |
| actor 长期 memory | system prompt + 开局简报 + 每条行动事实 | 下一次 LLM request 的稳定上下文 |
| action context dump | 本次 agent loop 的完整消息 | 审计、反查、快照观测 |
| `game_messages` | 公共事件流 | 客户端增量拉取与场景事件 |

三层不能互相替代：长期 memory 不是公共消息，context dump 不是下一轮 prompt，公共消息也不承担 agent 私有记忆。

## 行动事实

每次行动只落一条 action memory：做了什么、为什么、结果。可以有结构化元数据，但顶层长期记忆保持为一条可读事实，不保存逐轮对话。NPC 的“为什么”来自计划里的内心理由；玩家直接提交可以带理由，没有时明确标记为玩家直接提交。

长期 memory 由 system prompt、可选的 `openingBriefing` 与行动事实组成；compact 后 `[1..]` 收敛为一条 human summary。任务提示词、环境观察、工具调用与结果不单独成为长期记忆条目。

## Context dump

每条 action memory 附加一份 context dump，只包含产生该行动的那一次 loop：本次环境观察、任务提示词、AI tool_calls、工具结果、多轮 loop 的中间消息，以及终止工具的提交与结果。不包含 system prompt、之前的行动事实、之前的 loop 轨迹或其他 actor 的 memory。

它是审计旁路。下一轮只用长期 memory 加当前回合的环境与任务提示词，不会把历史 dump 塞回 prompt；当前也没有“主动回读完整 context”的工具。

## 开局简报

`openingBriefing` 是内容定义层给一个 actor 的本局私有简报，位于 `World.actors[]`，不是数据库字段。建局时 `createGame` 把它写成 actor memory 的第二条消息：system（profile + world + 全局规则）、human（openingBriefing）、human（第一轮当前环境）。

它可以包含目标、任务、初始处境、约束与已知信息，用自由文本表达；只在建局时注入一次，进入长期 memory，因此后续仍能读到。它不是单轮任务提示词，也不是公共消息；没有简报的 actor 不产生这条 human message。

## 记忆压缩

actor、stage、world 的 memory 都遵循同一闭环：`[0]` 是 system，`[1]` 是 human，之后是运行历史。compact 把 `[1..]` 压成一条新的 human summary，memory 回到 system + summary；system 永远不动，不生成第二套状态。

摘要必须保留仍然有效的身份、目标、底线、关系、关键事实与未解决冲突。新 summary 的 metadata 保存被压缩的旧消息 `compactedMessages` 与条数、时间、`contextUsageRatio`，只含 `[1..]`；旧 summary 自身也带更早的归档，因此连续 compact 形成可递归展开的树。

compact 手动触发：`agent:game compact --game <game> --owner actor --name <actor>`，`--owner` 也可以是 stage 或 world，`--owner all` 一次处理全部；`--min-ratio <0..1>` 只在当前 `contextUsageRatio` 达到阈值时执行。比例取自最近一条 AI 消息的 metadata，并在每次追加 AI 消息时写回。compact 在事务外调用 LLM，在完整 turn 边界落账；LLM 失败或记忆在压缩期间变化时不改数据库。

## 任务提示词

任务提示词属于单次 loop 的临时输入，不进入长期 memory；它随 context dump 保留，供事后还原当时的决策条件，下一轮重新生成。`openingBriefing` 是一次性建局消息，不算任务提示词。

## 工具

只读 GET 有 `look_stage`、`get_self`、`observe_actor`，可多次调用并立即返回：`get_self` 返回自己的完整信息，`observe_actor` 只返回同场景目标携带的物品（含物品级数值与是否穿戴），不暴露对方的角色属性与生命。所有 actor 都拥有 `query`：检索公共知识，参数是关键词 `keywords` 而非整句提问，只读、不占动作额度，因此不写进 `actions`。

动作工具共十二个，彼此平级，每个工具的参数就是该动作的全部输入，没有中间分类或 `purpose` 参数，也不写游戏状态；是否一次返回多个调用由 LLM 决定，循环层按顺序串行执行。`submit_plan` 是终止工具，只提交已暂存计划。

| 动作 | 参数 | 可见性 |
| --- | --- | --- |
| `say` | mind / targetActorName / message | stage |
| `whisper` | mind / targetActorName / message | private |
| `announce` | mind / message | stage |
| `move` | targetStageName | stage |
| `wait` | 无 | stage |
| `attack` | targetActorName（武器来自 `equipment.weapon`） | stage |
| `steal` | targetActorName / itemName（活人只能拿背包，尸体不限） | private |
| `give` | targetActorName / itemName | stage |
| `pickup` | itemName | stage |
| `use` | itemName /（targetActorName 或 targetStageName）/ targetDetail（仅场景） | stage |
| `equip` | itemName / slot | stage |
| `unequip` | slot | stage |

计划是有序动作列表，最多 `MAX_ACTIONS_PER_TURN = 2` 条；不做分类互斥，只限制条数。“通常一次沟通加一个其他动作”由提示词约定，超过 2 条时 handler 立即报错。两个动作按调用顺序应用，先移动后说话与先说话后移动结果不同。

每个成功应用的动作产生一条公共事件，`kind` 就是动作名，可见范围由动作决定（`whisper` 与 `steal` 为 private，其余为 stage）。同场景公开动作会向其他 actor 写入可见行动观察；`wait` 不改变场景状态。`hp` 为 0 的 actor 不能进入下一次 loop；伤害只写 `hp`，不判定死亡，死亡由随后的死亡阶段统一宣布（写公共事件与记忆，不需要 LLM）并尽力补一张尸体外观快照；默认玩家死亡由死亡阶段通知 world，是否收尾与结局标签都由 world 回合给出。死亡阶段的结果（宣布 / 外观的成功与失败）随 `ApplyPlanResult.death` 返回给调用方，失败不进 actor 记忆。工具调用轨迹属于本次 loop，进入 context dump，不进入长期 memory 顶层。

## 沟通动作

| 动作 | 目标 | 听见范围 | 公共可见性 |
| --- | --- | --- | --- |
| `say` | 必须指定单个目标 | 发起者、目标、同场景其他 actor | stage |
| `whisper` | 必须指定单个目标 | 只有发起者与目标 | private |
| `announce` | 无目标 | 同场景所有 actor | stage |

`say` 是带目标的公开说话：目标与旁观者都得到带双方身份的观察文本。`whisper` 只有双方进入 memory。`announce` 按场景广播。受话者与旁观者不写“为什么”，只写发生了什么与当时的场景上下文；只有发起者写行动事实与理由。

## 移动与战斗的信息不对称

`move` 是唯一同时触及两个场景的动作，记忆刻意保持不对称：移动者本人得到路线反馈，知道从哪到哪；旧场景记忆只写“他离开了”，旧场景其他 actor 得到离开观察；新场景记忆只写“他进入了”，新场景其他 actor 得到进入观察。起点与终点的组合不写给任何旁观者，移动者也不会收到自己的离开/进入观察。

战斗按“谁的伤口”分流：只有受害者自己的反馈带剩余 HP；发起者的行动反馈与同场景旁观者只知道这一下造成多少伤害、对方是否倒下，不知道对方还剩多少生命。完整数值只写进 `game_messages` 与舞台记忆。

## 物品与能力

物品触及的统一原则是 item-centric：`attack` 与 `use` 只是 dispatcher，负责选择物品、校验目标并调用 `item.effect`；具体效果由 `effect.type` 路由到的 handler 承担，每个动作最多引用一件物品。

- `damage`：先走固定公式 `max(0, 攻击方总 damage - 目标总 block)`，两侧都用 `addStats()`（自身 stats + 物品 stats），目标装备在结算时现读；`strength` / `wisdom` / `agility` 保留但不参与结算；有 `affixes` 时，默认效果执行完再跑一次事务外 LLM 补充效果。
- `event`：只写“使用了某物”的事件，后果交给 stage / world。

物品必须显式声明 effect，没有默认效果；`affixes` 是根部的字符串数组，是默认 effect 之后的补充机制，不改变路由。空手攻击使用系统 `damage`，不依赖物品行；`attack` 的武器固定来自 `equipment.weapon` 且必须声明 `damage`，否则按空手结算；`use` 接受全部物品。未来新增 `heal`、`open` 等效果时只注册新 handler，不在 `attack` / `use` 里写分支。

`equip` / `unequip` 只改 `actors.equipment` 的“槽位 → 物品名”索引：物品行不动，也不触发外观推理。同槽再装备是替换，旧装备自动退回背包；大类与槽位一一对应，所以一件物品只可能出现在一个槽位。

物品能被谁看见、能被谁拿走，与效果和槽位无关，见 → 参见：[物品](items.md)。

目标不需要存活：规则全局只有一条——行动者自己必须活着，尸体可以被说话、攻击、给予、使用与偷窃（对尸体攻击在伤害结算处空转，不改 HP）。这是给复活类玩法留的口子；NPC 的可选目标与观察里的“可作用对象”也包含尸体，没有第二套过滤。`pickup` 把 `stage_items` 移入背包；`use` 的目标只能是当前场景、自己或同场景角色，对场景使用时可用 `targetDetail` 描述具体部位，该描述只是行动声明，后果由 stage / world 裁决。

能力在内容里逐角色、逐场景显式写出，不设共享默认值：创建游戏时写进 `actors.actions` / `stages.actions`，运行时以数据库为准。NPC 只暴露被允许的工具；结算层 `assertActionAllowed` 是权威校验，玩家入口与脚本同样受约束。

## 事务边界

LLM 与 agent loop 在数据库事务外完成。行动应用层在短事务中锁定 game、校验当前状态、应用变更、递增版本、写公共消息与 memory，不持锁等待模型返回。

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

→ 参见：[数据库](database.md)、→ 参见：[开发期 Agent 工作流](debug-workflow.md)、→ 参见：[LLM 基础组件](llm.md)

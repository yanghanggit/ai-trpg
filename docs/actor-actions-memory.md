# Actor 行动与记忆

本文定义 actor 行动与记忆的目标原则。当前实现仍处在从原始 loop memory 迁移到压缩 action memory 的阶段；迁移完成后以代码为准。

## 第一级概念

`actor` 是第一级实体。NPC 与玩家不是两种 actor 表，而是同一个 actor 的两种控制者。NPC 由 agent loop 驱动，玩家通过接管关系直接提交行动；actor 的身份、场景归属、物品、状态与 memory 不因控制者改变。

actor 目前只有一个运行时容器：`items` 道具队列。鼠王的沉睡属于角色 profile，由 LLM 根据场景记忆判断是否苏醒。

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

NPC 工具分为只读 GET、动作与终止工具。`look_stage`、`get_self`、`observe_actor` 是只读 GET，可多次调用并立即返回结果；`get_self` 返回自己的完整信息，`observe_actor` 只返回同场景目标携带的物品，不暴露 stats 或状态。只有 `actions` 中列出 `query` 的原住民 actor 额外拥有该工具；它检索公共知识，不返回秘密或当前状态，不占行动。是否一次返回多个调用或分多轮调用由 LLM 决定，循环层按返回顺序串行执行。动作工具共十个，彼此平级：`say`、`whisper`、`announce`、`move`、`wait`、`attack`、`steal`、`give`、`pickup`、`use`；每个工具的参数就是该动作的全部输入，没有中间分类或 `purpose` 参数。`submit_plan` 是终止工具，只提交已暂存计划。工具 handler 不写游戏状态。

计划是**有序动作列表**，最多 `MAX_ACTIONS_PER_TURN = 2` 条；不做分类互斥，只限制条数。“通常一次沟通加一个其他动作”由提示词约定，工具 handler 在超过 2 条时立即报错给模型。两个动作按调用顺序应用，先移动后说话与先说话后移动是不同结果。

每个成功应用的动作都产生一条公共事件，`kind` 就是动作名（`say` / `whisper` / `attack` / …）；可见范围由动作自己决定（`whisper` 与 `steal` 为 private，其余为 stage）。同场景公开动作会向其他 actor 写入可见行动观察。`wait` 只是不改变场景状态。actor 的 `status` 为 `dead` 时不能进入下一次 loop；伤害使目标 `stats.hp` 归零时同时写入 `status=dead`。工具调用轨迹属于本次 loop，进入 context dump，不进入长期 memory 的顶层事实。行动的应用发生在 loop 结束后，由统一行动应用层校验并按顺序提交。

## 沟通动作

| 动作 | 目标 | 听见范围 | 公共可见性 |
| --- | --- | --- | --- |
| `say` | 必须指定单个目标 | 发起者、目标、同场景其他 actor | `stage` |
| `whisper` | 必须指定单个目标 | 只有发起者与目标 | `private` |
| `announce` | 无目标 | 同场景所有 actor | `stage` |

`say` 是有目标公开：目标与旁观者都得到带双方身份的观察文本。`whisper` 只有双方进入 memory。`announce` 没有目标，按场景广播。

受话者与旁观者不写“为什么”，只写发生了什么与当时的场景上下文；行动发起者才写行动事实与理由。

## 动作

动作只有一层，十个动作平级，没有“沟通 / 移动 / 交互”这类收口概念。每个 actor 有一个显式的 `actions` 列表，决定它能用哪些动作；stage 也有自己的 `actions`（当前有 `submit_environment` / `notify_world`），决定它作为小 GM 能调用哪些工具。

| 动作 | 参数 | 可见性 |
| --- | --- | --- |
| `say` | mind / targetActorName / message | stage |
| `whisper` | mind / targetActorName / message | private |
| `announce` | mind / message | stage |
| `move` | targetStageName | stage |
| `wait` | 无 | stage |
| `attack` | targetActorName / itemName（可选） | stage |
| `steal` | targetActorName / itemName | private |
| `give` | targetActorName / itemName | stage |
| `pickup` | itemName | stage |
| `use` | itemName /（targetActorName 或 targetStageName）/ targetDetail（仅场景） | stage |

物品触发的统一原则是 **item-centric**：`attack` 与 `use` 只是 dispatcher，负责选择物品、校验目标并调用 `item.effect`；具体效果由 `effect.type` 路由到的 handler 承担。每个动作最多引用一件物品。

- `{ "type": "damage" }`：当前战斗公式 `max(0, 攻击者 stats.attack + 物品 stats.damage - 目标 stats.defense)`。
- `{ "type": "event" }`：只写“使用了某物”的事件，后果交给 stage / world。

物品必须显式声明 effect，没有默认效果，也没有 `actions` 元数据。空手攻击使用系统 `{ "type": "damage" }`，不依赖物品行。`attack` 只接受 `damage` effect，NPC 工具也只暴露 damage 物品；`use` 接受全部物品。运行时两者都只按 `effect.type` 分派。未来新增 `heal`、`open` 等效果时，只注册新的 handler，不在 `attack` / `use` 里写分支。目标 defense 是唯一 block，物品 block 不参与当前伤害。`steal` 允许对尸体取物；`give` 只能给存活角色；`pickup` 把 `stage_items` 移入背包；`use` 的目标只能是当前场景、自己或同场景角色，对场景使用时可用 `targetDetail` 描述锁孔、炉膛等具体部位。该描述只是一次行动声明，具体后果由 stage / world 裁决。

能力在种子（`seeds/dark-fantasy.ts`）里**逐角色逐条**写出，不设共享默认值：动物只有 `say` / `whisper` / `announce` / `move` / `wait`（狗与鼠王再加 `attack`），人类才有 `give` / `pickup` / `use`，偷窃只属于当前剧本的无名者。知识检索作为只读能力写进同一个 `actions` 清单，当前只给奥德里克、坏运气与鼠王；玩家角色与煤渣没有该工具。创建游戏时写进 `actors.actions` / `stages.actions`，运行时以数据库为准。stage 的能力是 `submit_environment` 与 `notify_world`，环境写法与通知边界写在工具描述里，属于“工具即上下文”；world 的能力是 `notify_stage` 与 `end_game`。NPC 只暴露被允许的工具；结算层 `assertActionAllowed` 是权威校验，玩家入口与脚本调用同样受约束（拒绝原因会直接返回给调用方）。计划条数由 `MAX_ACTIONS_PER_TURN` 限制。

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

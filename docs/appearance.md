# 外观（appearance）

外观是运行时动态量，不是角色身份。角色的稳定视觉数据是签名上的 `form`，运行时可见外观是 `appearances` 里的一条渲染记录，两者分层存在。

## 模型

- `actor_signatures`：一个 actor 可被看见的「签名」，只存稳定形态。一条签名对应一种可辨识形态；每个 actor 同时只有一条正在使用的签名（`ended_at is null`）。
- `form`：稳定的形态描述，统一写成 `种族:描述`，例如 `人类:整体形态…`；种族不加方括号，否则导出成 Markdown 时会变成链接引用定义。种族是整体形态（具体种族由内容层定义），描述里应包含能锁定身份的标记部位。换装不会改写它。
- `appearances`：外观的 append-only 渲染记录。每行包含 `text`（最终渲染值）、`input`（生成输入快照）、`source`（seed / runtime）与 `superseded_at`。每个签名同时只有一条 `superseded_at is null` 的当前记录，历史行不覆盖、不删除。
- `ActorState.appearance` 是 `{ id, text }`：`text` 用于展示，`id` 指向那条渲染记录，可据此追溯来源。
- `equipment`：槽位到物品名的索引。物品自己不知道是否被穿戴，穿戴状态只由 actor 的索引维护。

## 签名是引擎层抽象

「可被看见的样子」是通用机制，不属于任何故事：换装会追加一条新的外观记录；伪装、变身这类改变**身份可辨识性**的行为会开一条新签名并把旧的 `ended_at` 封上，于是认识旧签名的人看到新签名时认不出他，摘下面具切回旧签名时又认得。签名之间没有「本相 / 变体」的语义字段，它们只是同一个 actor 的不同形态。

机制在引擎层，解释在内容层：引擎只认「当前签名是哪一条」，面具、法术、诅咒、变形这些说法由内容写在物品、场景或角色设定里，不为某个故事增加新的 apply 分支。

→ 参见：[术语表](glossary.md)

actor 的 system prompt 使用**开局签名**的 `form` 快照：外观一变就重写 prompt，会让「宪法」随每次换装漂移；之后切换签名也不重建 prompt。

## 来源快照

每条运行时外观都保存生成那一刻的输入，目标是能复盘、必要时能重放：

- `prompt.messages`：当时发给模型的完整 memory 消息。
- `prompt.inputMessage`：本次「外观更新」任务全文（含形态、世界背景与当前穿戴）。
- `prompt.tools`：当时可用的工具定义；正常只有 `submit_appearance`，死亡时会多一个 `submit_appearance_brief`。
- `context.form` / `context.dead` / `context.worn`：结构化摘要；`worn` 是穿戴项的快照（物品之后可能改名或删除，因此不引用当前物品行）。
- `context.brief`：本次变化的可见简报；死亡时由死者自己先写，换装 / refresh 没有。
- `model` / `contentVersion`：模型（当前 provider 契约未暴露，先记 null）与内容版本。提示词本身随快照一起存下，不再另记版本号。

`source` 只区分「预编译 / 运行时」；具体是换装、死亡、refresh 还是自定义事件，由 `context.dead`、`context.brief` 与 `worn` 的变化判断，不再维护触发原因枚举。

种子外观也落一行，`source: "seed"`，`input` 只记录内容 key、内容版本、actor key、`form` 与是否回退到 `form`；它没有 LLM prompt。

## 推理流程

入口在 `src/game/appearance/turn.ts`：以 actor memory 为上下文，追加一段「外观更新」任务，跑一次 agent loop。

- 输入只提供当前签名的 `form` 与槽位索引解析出的穿戴物品，不提供旧 `appearance`，避免模型复述旧值；提示词明确要求「穿戴不等于露出」：被衣物遮住的贴身物件不写进外观。
- 战役设定与全局规则由 actor 的宪法（system prompt）携带，任务输入不重复下发；输入只到「角色自身」为止：不注入 stage 的 `environment` / `profile`，也不开放 `query`。外观是当前数据的快照（后续用于文生图），不追环境的实时变化——否则「下雨淋湿」就要推导「换到干燥场景后变干」，没有稳定终点。
- 饰品（`accessory`）不参与外观推理：这个大类的语义随题材漂移（它也可能指与外观无关的植入物），引擎保留槽位与穿戴索引，外观只消费衣物与武器，避免内容定义渗进引擎。
- 终止工具是 `submit_appearance`，提交新的第三人称外观快照；推理过程不写 memory，也不改 system prompt。
- 死亡时可以多一个 `submit_appearance_brief`：死者先用自己的记忆写一段“本次变化”的第三人称简报（死因、伤口、可见损伤、姿势等），工具返回后继续调用 `submit_appearance` 生成最终外观。简报不是终止工具，也不会单独落库；它随最终外观写进 `context.brief`。
- 成功后在事务内追加外观记录、把同一签名的旧当前记录标为已取代，并递增 game version；随后向同场景其他 actor 追加一条外观变化观察：句子只带观察者视角的引用（当前称呼或 `#编号`），新外观另起一行，名字不会外泄；死亡收尾与批量 `refreshAppearances` 不广播，避免重复。
- 失败不写记录，也不改动当前外观。

## 死亡

死亡时的外观生成逻辑不变：死者仍以当前签名的 `form`、自己的 memory 与尸体任务跑一次外观推理，结果作为新的当前记录写回同一签名。区别是：

- 先由死者自己调用 `submit_appearance_brief` 写一段可见变化简报，再据此生成最终尸体外观。
- 审计字段为 `source: "runtime"`、`context.dead: true`、`context.brief`；`prompt.inputMessage` 是尸体快照任务。
- 死亡收尾不广播外观变化。

如果死者没有提交简报（模型直接提交最终外观，或简报未通过校验而没有再次提交），外观仍按原逻辑只读 memory 生成，`context.brief` 缺省。

如果死亡外观推理失败，当前外观保持生前的最后一条记录，`appearanceFailed` 照常记录。

## 换装入口

`equip` / `unequip` 在事务内只改穿戴索引；调用方提供 `appearanceService` 时，`applyActorPlan` 会在事务提交后补一次外观推理（失败只记日志，不回滚已落账的穿戴）。NPC 回合与 `agent:game player-equip` 都带这个 service，所以一次换装是「规划 + 外观」两个 loop；玩家接管路径没有规划 loop，只有外观 loop。不提供 service 的入口（测试、未接服务的路由）保持旧行为：外观暂时落后，由 `agent:game appearance` 显式补推。

`setEquipmentSlot` 是「改槽位 + 立刻重算外观」的便捷入口：槽位与外观各用短事务，LLM 调用在事务外。批量入口 `refreshAppearances` 幂等：活人重推，未收尾的死者交死亡阶段，已收尾的尸体跳过。

槽位只有 `weapon`、`armor`、`accessory` 三个，一个大类只对应一个槽位。

→ 参见：[物品](items.md)、[数据库](database.md)

## 种子数据

种子里的 `signature.appearance` 是预制结果：等于提前跑过一次推理，把 `form`、穿戴与剧情润色写成最终外观；建局时它会成为该签名的第一条 `source: "seed"` 记录，运行时换装再追加新记录。预制外观与运行时推理遵循同一套输入规则：`form` + 非饰品穿戴 + 剧情痕迹，所以也不写 `accessory`。种子同时显式写出穿戴中的装备，通过 `equipment` 索引指向物品名。

动物 / 怪物不写 `signature.appearance` 时，`text` 回退为 `form`，`input.fallback` 为 true，它们不穿戴装备。

→ 参见：[bell-monastery.md](../apps/server/seeds/dark-fantasy/bell-monastery.md)

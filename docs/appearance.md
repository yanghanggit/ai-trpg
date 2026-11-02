# 外观（appearance）

外观是运行时动态量，不是角色身份。角色的稳定视觉数据是签名上的 `form`，运行时可见外观是 `appearance`，两者分层存在。

## 模型

- `actor_signatures`：一个 actor 可被看见的「签名」，是 `form` 与 `appearance` 的唯一存储位置。一条签名对应一种可辨识形态；每个 actor 同时只有一条正在使用的签名（`ended_at is null`）。
- `form`：稳定的形态描述，统一写成 `[种族]:描述`，例如 `[人类]:高瘦，左眉断了一截…`。种族是整体形态（人类、犬、鼠、机械体…），描述里应包含能锁定身份的标记部位。换装不会改写它。
- `appearance`：其他 actor 与 stage 实际看到的样子，由 `form`、当前穿戴与自身润色（血迹、灰尘、伤势、姿态、最近发生的事）合成——不是字段拼接，而是一次 LLM 推理。
- `equipment`：槽位到物品名的索引。物品自己不知道是否被穿戴，穿戴状态只由 actor 的索引维护。

## 签名是引擎层抽象

「可被看见的样子」是通用机制，不属于任何故事：换装只改当前签名的 `appearance`；伪装、变身这类改变**身份可辨识性**的行为会开一条新签名并把旧的 `ended_at` 封上，于是认识旧签名的人看到新签名时认不出他，摘下面具切回旧签名时又认得。签名之间没有「本相 / 变体」的语义字段，它们只是同一个 actor 的不同形态。

机制在引擎层，解释在内容层：引擎只认「当前签名是哪一条」，面具、法术、诅咒、变形这些说法由内容写在物品、场景或角色设定里，不为某个故事增加新的 apply 分支。

→ 参见：[术语表](glossary.md)

actor 的 system prompt 使用**开局签名**的 `form` 快照：外观一变就重写 prompt，会让「宪法」随每次换装漂移；之后切换签名也不重建 prompt。

## 推理流程

入口在 `src/game/appearance.ts`：以 actor memory 为上下文，追加一段「外观更新」任务，跑一次 agent loop。

- 输入只提供当前签名的 `form`、世界背景（`campaignSetting`）与槽位索引解析出的穿戴物品，不提供旧 `appearance`，避免模型复述旧值；提示词明确要求「穿戴不等于露出」：被衣物遮住的贴身物件不写进外观。
- 输入只到「角色自身 + 战役背景」为止：不注入 stage 的 `environment` / `profile`，也不开放 `query`。外观是当前数据的快照（后续用于文生图），不追环境的实时变化——否则「下雨淋湿」就要推导「换到干燥场景后变干」，没有稳定终点。
- 饰品（`accessory`）不参与外观推理：这个大类的语义随题材漂移（它也可能指与外观无关的植入物），引擎保留槽位与穿戴索引，外观只消费衣物与武器，避免内容定义渗进引擎。
- 唯一工具是 `submit_appearance`，终止时提交新的第三人称外观快照；推理过程不写 memory，也不改 system prompt。
- 结果写回当前签名的 `appearance` 并递增 game version，随后向同场景其他 actor 追加一条外观变化观察：句子只带观察者视角的引用（`@名字` 或 `#编号`），新外观另起一行，名字不会外泄；死亡收尾与批量 `refreshAppearances` 不广播，避免重复。

## 换装入口

`equip` / `unequip` 在事务内只改穿戴索引；调用方提供 `appearanceService` 时，`applyActorPlan` 会在事务提交后补一次外观推理（失败只记日志，不回滚已落账的穿戴）。NPC 回合与 `agent:game player-equip` 都带这个 service，所以一次换装是「规划 + 外观」两个 loop；玩家接管路径没有规划 loop，只有外观 loop。不提供 service 的入口（测试、未接服务的路由）保持旧行为：外观暂时落后，由 `agent:game appearance` 显式补推。

`setEquipmentSlot` 是「改槽位 + 立刻重算外观」的便捷入口：槽位与外观各用短事务，LLM 调用在事务外。批量入口 `refreshAppearances` 幂等：活人重推，未收尾的死者交死亡阶段，已收尾的尸体跳过。

槽位只有 `weapon`、`armor`、`accessory` 三个，一个大类只对应一个槽位。

→ 参见：[物品](items.md)、[数据库](database.md)

## 种子数据

种子里的 `signature.appearance` 是预制结果：等于提前跑过一次推理，把 `form`、穿戴与剧情润色写成最终外观，运行时换装会覆盖它。预制外观与运行时推理遵循同一套输入规则：`form` + 非饰品穿戴 + 剧情痕迹，所以也不写 `accessory`。种子同时显式写出穿戴中的装备，通过 `equipment` 索引指向物品名。

动物 / 怪物不写 `signature.appearance` 时，`appearance` 回退为 `form`，它们不穿戴装备。

→ 参见：[bell-monastery.md](../apps/server/seeds/dark-fantasy/bell-monastery.md)

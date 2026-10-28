# 外观（appearance）

外观是运行时动态量，不是角色身份。角色的稳定数据是 `base_body`，运行时可见外观是 `appearance`，两者分层存在。

## 模型

- `base_body`：种族 + 裸体描述，捏脸完成、尚未穿装备的形态；只有它进入 actor 的 system prompt（`### 基础体型`）。
- `appearance`：其他 actor 与 stage 实际看到的样子，由基础体型、当前穿戴与自身润色（血迹、灰尘、伤势、姿态、最近发生的事）合成——不是字段拼接，而是一次 LLM 推理。
- `equipment`：槽位到物品名的索引。物品自己不知道是否被穿戴，穿戴状态只由 actor 的索引维护。

system prompt 只描述稳定的 `base_body`：外观一变就重写 prompt，会让「宪法」随每次换装漂移。

## 推理流程

入口在 `src/game/appearance.ts`：以 actor memory 为上下文，追加一段「外观更新」任务，跑一次 agent loop。

- 观察只提供 `base_body` 与槽位索引解析出的穿戴物品，不提供旧 `appearance`，避免模型复述旧值；提示词明确要求「穿戴不等于露出」：被衣物遮住的饰品与贴身物件不写进外观，只有明显露在外面的才写。
- 唯一工具是 `submit_appearance`，终止时提交新的第三人称外观快照；推理过程不写 memory，也不改 system prompt。
- 结果写回 `actors.appearance` 并递增 game version，之后所有同场景观察立即使用新值。

## 换装入口

`equip` / `unequip` 只修改穿戴索引，**不**触发外观推理：动作在事务内完成，推理是一次 LLM loop，必须留在事务外。外观因此可能短暂落后于 `equipment`，由 `agent:game appearance`（或客户端）显式推动一次合并推理。

`setEquipmentSlot` 是「改槽位 + 立刻重算外观」的便捷入口，装备动作与客户端换装都走它：槽位与外观各用短事务，LLM 调用在事务外。批量入口 `refreshAppearances` 幂等：活人重推，未收尾的死者交死亡阶段，已收尾的尸体跳过。

槽位只有 `weapon`、`armor`、`accessory` 三个，一个大类只对应一个槽位。

→ 参见：[物品](items.md) → 参见：[数据库](database.md)

## 种子数据

种子里的 `appearance` 是预制结果：假装已完成一次推理，把基础体型、装备与剧情润色写成最终外观，运行时换装会覆盖它。种子同时显式写出穿戴中的装备，通过 `equipment` 索引指向物品名。

动物 / 怪物没有单独外观时 `appearance` 回退为 `base_body`，它们不穿戴装备。

→ 参见：[bell-monastery.md](../apps/server/seeds/dark-fantasy/bell-monastery.md)

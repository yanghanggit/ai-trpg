# 外观（appearance）

外观是运行时动态量，不是角色身份。角色的稳定数据是 `base_body`，运行时可见外观是 `appearance`，两者分层存在。

## 模型

- `base_body`：种族 + 裸体描述，类似捏脸完成、尚未穿装备的形态；只有它进入 actor 的 system prompt（`### 基础体型`）。
- `appearance`：其他 actor 与 stage 实际看到的样子，由基础体型、当前穿戴和自身润色组成。
- `actors.equipment`：槽位到物品名的索引。物品自身不记录是否被穿戴，只知道自己存在；是否穿戴、穿在哪个槽位由 actor 的索引维护。

外观推导为 `appearance = base_body + 当前穿戴 + actor 自身润色`。“自身润色”来自 actor memory：血迹、灰尘、伤势、姿态、最近发生的事。不是字段拼接，而是一次 LLM 推理。

## 推理流程

入口在 `src/game/appearance.ts`。它用 actor memory 作为上下文，追加一段“外观更新”任务，然后跑一次 agent loop：

- 观察只提供 `base_body` 与 actor 槽位索引解析出的穿戴物品，不提供旧 `appearance`，避免模型复述旧值；
- 唯一工具是 `submit_appearance`，终止时提交新的第三人称外观快照；
- 推理过程不写 memory，也不修改 system prompt；
- 结果写回 `actors.appearance`，递增 game version，之后所有同场景观察立即使用新值。

system prompt 不包含 `appearance`。它只描述稳定的 `base_body`；如果外观变化就重写 prompt，会让“宪法”随每次换装漂移。

## 换装入口

`setEquipmentSlot` 修改 actor 的某个槽位（指向物品名或清空），然后立刻调用一次外观推理。后续装备动作、客户端换装都走这个入口；LLM 调用在事务外，槽位与外观更新各自使用短事务。

槽位目前包括武器、副手、头部、身体、足部与饰品；每个槽位只允许对应大类的物品。同一件物品只能占一个槽位，换到新槽位时会从旧槽位移除。

## 种子数据

种子里的 `appearance` 是预制结果：假装已经完成一次推理，把基础体型、装备和剧情润色写成最终外观。运行时换装会覆盖它。

种子还显式写出了穿戴中的装备（例如斗篷、铁锹、裹尸布、钥匙、断链），通过 actor 的 `equipment` 槽位索引指向物品名；外观推理与观察都以此为准。

动物/怪物没有单独外观时，`appearance` 回退为 `base_body` 描述；它们不穿戴装备。

→ 参见：[数据库](database.md) → 参见：[Actor 记忆](actor-actions-memory.md) → 参见：[临时测试剧本](test-scenario.md)

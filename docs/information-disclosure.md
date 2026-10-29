# 信息披露：actor / stage / world / item

四个核心实体共用一条分界：**实体的名字与稳定 id 属于控制面，世界面只出现角色能感知到的引用、外观与事实**。但“谁全知、全知什么”并不相同。

结论：

- **actor 的名字是知识**，按「观察者 × 形象」记录；换形象即失效。
- **stage 与 world 是全知的裁决者，但全知的对象是世界状态，不是角色的内心**。stage 看本场景角色、外观与携带物；world 看全部 actor 的名字与所在场景、全部场景陈列；两者都不读 actor 的 profile 与 memory，world 也不看 actor 外观与背包。
- **stage 只全知本场景，world 全知全部场景**；stage 之间没有直接通道。
- **item 的名字是公共标签**，不做 actor 级知识隔离；位置与持有关系仍靠观察范围。
- **全知不等于可以下推**。stage / world 写出的环境、裁决与结局文案受统一守卫；事实与机制的保密仍靠提示词与内容分层。
- **认知隔离只属于 actor**：称呼、引用与外观这套机制处理的是「这个角色知道谁是谁」。stage / world / item 没有观察者相对的名字信念，也不使用引用，它们用名字与公共标签。

细节分别归：[术语表](glossary.md)、[Actor 记忆](actor-actions-memory.md)、[Stage 小 GM](stage.md)、[物品](items.md)。

## 四个实体

- **actor**：有身体、形象、记忆与认知边界的行动者。名字是它相信的东西，不是系统路由表。
- **stage**：本场景的小 GM。有 profile、environment、场景记忆与通道能力；只读本场景，向外只能通过 world 中转。
- **world**：全局叙事者与规则管理者。有世界设定与全部场景状态；负责跨场景裁决与收尾。
- **item**：有名字、大类、描述与声明式效果的对象。名字是公共标签；它此刻在哪里、在谁身上才是观察结果。

## 全知的边界

“全知”只描述**世界状态**：

- world 知道全部场景的 profile、environment、在场 actor 名与场景陈列物品；
- stage 知道自己的 profile、environment、在场 actor 名与外观、本场景陈列物品、未开启通道；
- 两者都**不读** actor 的 profile、opening briefing 或 agent memory；
- actor 的 profile 只进入它自己的 system prompt；story 整理器是唯一的全量读者，但它不是实体，也不参与裁决。

因此 stage / world 不会因为“全知”而知道角色的秘密、动机或记忆。它们看到的是可观察状态与场景报告。

推理端的仲裁 agent（如词缀）不属于四个实体：没有记忆与观察者视角，只读控制面事实、只做一次增量判定；它不写 actor 记忆，可见后果进场景记忆，由 actor 下次 pull。

## 披露矩阵

| 主体 | actor 能看到 | stage 能看到 | world 能看到 |
| --- | --- | --- | --- |
| actor | 自己的设定与记忆；同场景他者的形象、已知称呼、携带物品；自己的背包 | 本场景 actor 的名字、当前外观、携带物品与行动记忆 | 全部 actor 的名字与所在场景；不含 profile、记忆、外观与背包 |
| stage | 当前场景的 environment、陈列物品、开放出口、在场 actor | 自己的 profile、environment、记忆、未开启通道、本场景 actor 与物品 | 全部场景的 profile、environment、actor 名与陈列物品 |
| world | 只通过 campaign setting 与全局规则知道世界设定；不把 world 当对象 | 同 actor，另有世界设定与全局规则；不含 world profile | 自己的 worldName、profile 与全部场景状态 |
| item | 自己的物品；同场景他者携带的物品；当前场景的陈列 | 本场景陈列；本场景 actor 携带的物品 | 全部场景的陈列；不读 actor 背包 |

“场景陈列”只表示尚未被拾取的物品；一旦被拾取，它离开陈列，进入持有者的观察通道。

## 名字与称呼

- **actor**：名字用于路由；角色看到的是形象与它相信的称呼。称呼存在名字信念里，可以错、可以是假名、可以改口；引用是 `@名字` 或 `#编号`，不能说出口，但**可以出现在系统写给角色的文本里**（名单、观察、读取时的脱敏），因为它是寻址与辨认的锚点。
- **stage**：场景名是地点标签，不是身份信念，world 内全局唯一。actor 知道当前场景与开放相邻场景；stage 与 world 用名字路由。没有 `stage_knowledge` 表。
- **world**：world 名与 profile 属于 world 自己；actor 与 stage 只拿到世界设定与全局规则，不拿到 world 的收尾条件。
- **item**：名字、大类与描述是公共标签，任何实体在其观察范围内都能知道；不建物品级名字信念，也不用 `@` 引用，只写纯名字。

## 下行通道

| 通道 | 允许 | 禁止 |
| --- | --- | --- |
| actor → actor | 使用已知称呼或外观交谈、转述 | `@名字`、`#编号` |
| stage → actor | environment、观察与行动反馈，按观察者渲染：`@名字` 或 `#编号`，外观另起一行 | 角色名字（作为叙述对象） |
| world → stage | 世界裁决与跨场景变化，用自然描述 | 角色名字、`@`/`#` 引用 |
| world → player | 结局文案 | 角色名字、`@`/`#` 引用 |
| stage → world | 场景报告，可含名字 | 不构成对 actor 的下推 |
| stage ↔ stage | 无直接通道；经 world 或 actor 中转 | — |

stage 的 environment 在写入时被检查（拒角色名字与 `@`/`#` 引用），在 actor 读取时再按观察者脱敏一次：在场的角色写成 `@名字`；不知道名字时用 `#编号`，外观另起一行——对在场者来说外观永远可观测，不存在「看不清」的兜底。world 的裁决与结局在写入前检查。stage / world 的自身记忆是上帝视角，可以写名字；actor 的记忆在写入前统一脱敏（反馈与拒绝原因同样如此），CLI / 轨迹保留名字以便排障。`game_messages` 是 server→web 的事件通道，只写名字与稳定 id 供展示与后续寻址，不进入任何 agent 的 pull 上下文。推理端不写 actor 记忆：actor 记忆只由引擎的观察投递与显式维护写入，且都过世界面守卫；可见后果进场景记忆，由 stage 下次 pull。公共物品标签同样受守卫；compact 是显式维护，摘要只回写同一主体的记忆，主体自己的名字与引用合法。

## actor 与场景：在场、可达、可知

- **在场**：actor 只感知当前场景的 environment、陈列物品、在场角色。
- **可达**：只认当前场景的开放相邻边。客户端从观看者投影的 `exits` 拿到 `stageId` 与展示名，移动时用 `stageId`；服务端仍按邻接边复核。显示名就是名字，可直接作为移动目标。
- **可知**：记忆、公共知识检索与他人转述。它不授予通行权；actor 听说了远处的地方，也不能直接移动过去。

actor1 告诉 actor2 一个地方，只算 belief/hearsay，不算 access；actor1 自己没去过也一样。玩家提交的对话在进入 actor→actor 通道前还要先过[玩家对话审核](dialogue-audit.md)；审核拒绝不改变任何 actor 的记忆。引擎不从台词自动抽取地点事实；将来若需要结构化，走显式记录，且不改变“移动只看邻接”的规则。

## 仍未结构化

- **事实与机制**：stage / world 知道钥匙与锁孔吻合、通道是唯一出口，但没有结构阻止它们把未发现的事实写成可见线索；目前靠提示词与内容分层。
- **隐藏通道与秘密地点**：开放通道对所有在场 actor 可见，没有 per-actor 的通道可见性。
- **地点知识**：没有 `stage_knowledge`；传闻只存在记忆里。
- **传送历史**：`stage_visits` 只记录去过哪些场景，服务 `teleport` 与地图；不参与普通移动权限。
- **stage / world 的客户端投影**：目前只有 actor 的观看者投影；stage / world 仍是上帝视角文本。

→ 参见：[术语表](glossary.md)、[Actor 记忆与行动](actor-actions-memory.md)、[Stage 小 GM](stage.md)、[物品](items.md)、[Seed 内容编写原则](seed-authoring.md)

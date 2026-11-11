# Agent 与工具

分类只回答两件事：吃不吃世界宪法、记不记得上一轮。吃宪法的都在世界面，只服务框架自身的是框架工具。题材与触发方式会变，这两问不会。

## 世界面

### 记忆实体

拥有独立 memory 的实体 agent，即 `MEMORY_OWNER_TYPES` 登记的三类：world、stage、actor。身份、设定与长期状态由自己的 memory 承载，system prompt 是宪法；一局里可以有很多个，按实体逐个推进，事务、快照与 compact 都以 owner 为单位。

### 世界职能

世界级单例，与 world 平级但没有 memory。宪法在自己那一份文本里，三段：**职责**（产出什么）、**世界宪法**（战役设定与全局规则）、**本职能**（这件事在这个世界里怎么判、写到什么尺度、哪些专名要保住）。宪法在内容层定档、是**开局快照**：改代码或内容都不影响进行中的局。

输入由调用方现场组装（可跨多个实体、事件流或物品），产出是世界面文本、判定，或对某个记忆实体 memory 的改写。每种职能只有一份实现。

### 旁路

不新建实体，只借某个记忆实体的一份记忆做一次推理，因此不重复携带设定——它直接沿用目标的宪法。产物写回目标实体的是外观与尸体留下的材料，属运行流程；只回给调用方的是只读探针，让内容自己开口。

## 框架工具

世界面之外，既不持记忆也不吃设定：换一份 seeds 不需要改它一行。判据问它自己的口径，不是输入——**可以读、搬运、检查内容，但不能被内容定义**。名字审计读的是含世界内容的记忆，规则却与题材无关，注入设定反而会把合法用法判成泄漏。名字带 audit 不代表同类：`dialogue-audit` 是吃设定的世界职能。

## 当前归属

| 类别 | 目录 | 职责 |
| ---- | ---- | ---- |
| 记忆实体 | `agents/world-turn` / `agents/stage-turn` / `agents/actor-turn` | 世界、场景、角色各自的回合，各自推进 |
| 世界职能 | `agents/affixes` | 一次攻击里词缀造成了什么 |
| 世界职能 | `agents/story` | 把记忆与事件流整理成故事 |
| 世界职能 | `agents/compact` | 把超长记忆压成可继续用的短记忆 |
| 世界职能 | `agents/dialogue-audit` | 一句玩家台词能不能进入这个世界 |
| 旁路 | `agents/appearance` | 借角色记忆生成或刷新可见外观（活人重算 / 尸体刷新），写回实体 |
| 旁路 | `agents/death`（掉落） | 借死者记忆生成尸体留下的材料，写进尸体背包 |
| 旁路 | `agents/probe` | 借 actor / stage 记忆只读回答，只回调用方 |
| 框架工具 | `name-audit` | 检查 actor 记忆里的真名泄漏，无 LLM |

`game/` 分两层：本表前四类都在 `game/agents/`（`bypass/` 是旁路共用的推理回路，跟着一起）；其余平铺在 `game/` 根与 `game/kernel/`。

- `game/kernel/`：零 I/O 的内容形状与文本渲染——`types.ts`、`attributes.ts`、`limits.ts`、`addressing/`（谁能叫出谁）、`observation-text/`（观察文本）、`affixes.ts`（词缀形状归一）。除 `errors.ts` 与 `memory/kinds.ts` 两个零依赖常量外，它不 import 任何游戏模块；玩法与 agent 都可以依赖它，它不依赖回来。
- `game/` 根：动作与结算（`actions` / `settle` / `combat`）、状态投影（`actor-state` / `stage-state` / `item-state`）、观察（`observations`）、读侧与寻址（`lookup` / `client-view` / `route`）、持久化与装配（`persistence` / `memory` / `game-state` / `create-game`）、内容校验（`world-definition`）、玩家接管（`player`）、框架工具（`name-audit`）。

`agents/` 只被外面驱动，反向调用只有四组：`settle/` 调 `affixes` / `appearance` / `death`（推理端增量），`actions/` 调 `affixes`（静态词缀），`player/` 调 `dialogue-audit`（台词准入），`create-game/` 与 `world-definition/` 调 `appearance/form`（外观可用性校验）。新增反向边时改这一句——它登记的是「谁借了 agent 的一段纯逻辑」，不是允许 agent 反过来写状态。

分类也不看目录位置——框架文本审查在 `dev/`，文生图按要不要题材风格暂归世界职能，所以 `name-audit` 留在 `game/` 根、`imagegen` 在 `src/imagegen/`。

前两类有编译期枚举（`MEMORY_OWNER_TYPES` / `WORLD_FUNCTION_TYPES`），旁路没有：新增一个 LLM 调用时，先在这张表里定类，再决定它带不带 memory。

## Prompt 分层

- **system prompt** 是宪法与索引：记忆实体把宪法与内容写进长期 memory，不参与 compact；世界职能的是一份开局快照，另多一段职责（核心任务概述，不写工具细节）。两者都只写稳定且必须永远成立的内容。
- **任务提示词**（每轮 input）给本轮可见事实、当前状态与目标，以及工具之间的调度顺序。
- **工具描述**只写这个动作自身的契约：参数、效果与边界。

换一个工具就失效的写进工具描述；只对本轮或动作顺序有效写进任务提示词；与具体动作无关、整局都要成立的写进 system prompt。

### 工具构造

工具形状一律由 `build*Tool()` 返回，零参的也写成 builder，不导出共享常量。判据是这个工具的可见范围会不会随回合变化：会变的必然是函数，而工具列表逐回合装配，混进单例就会让装配处多出一条「哪些能改、哪些不能改」的规则。

参数只带本回合的可见范围（handles、场景名、槽位），builder 不自己读 state：读取归回合装配，工具只负责把拿到的范围写成 `enum`。零参 builder 今天没有参数，明天可能就有——常量改函数要动所有调用点，加参数不用。

永远不变、单用途、只有一个固定调用点的内部工具才用常量，如 `dialogue-audit` 的 `VERDICT_TOOL`。

## 记忆模块

记忆是 append-only 的事件与基线，不是状态缓存：环境、背包、位置由回合现拉，记忆只回答「发生过什么」与「开局是什么样」。读侧按 kind 过滤，不解析正文推断类别。

代码按职责分文件，对外只经模块出口：注入文本只在一个文件拼装且不碰数据库，行与消息形态的转换只有一处，序号与读写只在存储层。

三条不变量：同一个 (game, ownerType, ownerId) 只有一条 memory；缺 memory 时 actor 侧尽力而为、stage 与 world 直接抛，这个差异由调用方决定而不是在存储层兼容；开场注入必须幂等，因为写入入口不止一个。

## 设定注入

`campaignSetting` 是每局的世界宪法。世界面内的 agent 都要拿到它，否则材质名与压缩后的术语会退回模型的世界外常识，而下游看不出题材越界。

设定是约束，不是剧情事实：记忆实体与世界职能都经各自的 system prompt 携带（世界职能的宪法另加它自己的一份口径），旁路直接沿用目标的宪法。框架工具是唯一不注入的一组。任务提示词只放本轮事实——内容不进任务层。

→ 参见：[数据库](database.md)、[Stage 小 GM](stage.md)、[Actor 记忆](actor-actions-memory.md)、[数据驱动](data-driven.md)

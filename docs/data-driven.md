# 数据驱动：边界与当前内容泄漏

> 当前状态：物品不再直接决定通关；actor → stage → world 的分层链路已经建立。剩余内容泄漏集中在 demo 基础数据与 CLI 默认建局。

## 结论

`World`、`Stage`、`Actor`、`Item` 是系统框架概念；故事文本、角色关系、场景图、物品、能力与使用描述由内容输入提供，不写进 `game` 服务。

当前边界：

- 数据库 schema、领域类型、prompt 组装、动作结算、stage/world 能力全部与具体故事无关；
- 故事内容集中在 `seeds/dark-fantasy.ts`（枯钟修道院 / 黑疖病）；
- `use` 对场景可以携带 `targetDetail`，它只是 actor 的行动描述，写入 stage memory；
- stage 可以用 `notify_world` 把报告写入 world memory；
- world 可以用 `notify_stage` 下发裁决，用 `end_game` 结束游戏；
- 但 **demo 用户与 app_meta、CLI 默认建局**仍然把当前剧本写死在框架层。

数据驱动是持续目标，不是一次性完成状态。

## 当前隔离边界

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 数据库 schema | 已隔离 | world / stage / actor / item / message / memory 等通用概念；能力用 `actions` JSONB 承载 |
| 领域类型 | 已隔离 | `World` / `Stage` / `Actor` / `Item` / `WorldPlan` / `StagePlan` 均为通用容器 |
| 故事内容 | 已隔离到 seed | 场景名、角色与名字、profile、连接、物品、`actions`、环境文本、初始旁白都在 seed |
| system prompt | 由内容生成 | 角色、场景与 world 的身份、设定与全局规则来自 `World` 字段 |
| 执行细节 | 由内容/工具承载 | environment 写法在 `submit_environment` 描述里；通知与结束规则在 stage/world 工具描述里 |
| 角色与场景能力 | 已隔离 | `actors.actions` / `stages.actions` 决定 NPC 与 stage 工具 |
| world 能力 | 已隔离 | `World.actions` 决定 world 可用的 `notify_stage` / `end_game` |
| 物品使用 | 已隔离 | 物品只有身份、描述、分类、数值；不使用效果字段 |
| 通关条件 | 已移出框架 | 只有 world 能 `end_game`；stage/actor 没有该动作 |
| **demo 基础数据** | **有泄漏** | `db/maintenance.ts` 从 seed 导入 `DEMO_USER`，`app_meta` 写死 `dark-fantasy.v2` |
| **CLI 建局入口** | **有泄漏** | `scripts/agent-game.ts` 的 `create` 永远使用 `DARK_FANTASY_WORLD`，`--world-file` 只服务快照 `new` |
| 测试 | 已隔离 | 主要用例使用独立的 `TEST_WORLD`；另有 seed 回归测试直接断言演示内容 |
| 导出产物 | 不属于泄漏 | `prompts/` 是从内容生成的调试旁路，gitignore，数据库仍是运行时唯一真相 |

## 当前行动链路

```text
actor use(targetStageName, targetDetail)
  → stage memory 收到“某人在某处使用某物”的行动描述
  → stage 回合：判断本地后果
  → notify_world：把场景报告写入 world memory
  → world 回合：裁决世界级事实
  → notify_stage：把裁决写入 stage memory
  → end_game：只有 world 能结束游戏
```

关键边界：

- `targetDetail` 是行动声明，不是既成事实；
- stage 报告是报告，不是世界事实，也不是系统指令；
- world 不直接替 stage 写 environment；它下发 directive，由 stage 下一回合解释；
- 所有 LLM 调用都在数据库事务之外；stage/world 回合分别显式推进。

## 已移除的旧模型

以下内容已移除，不再作为物品或动作层的能力：

- `CompleteGameEffect` / `ItemUseEffect` / `ItemUseDefinition`；
- `item.use` 与 `item.effects`；
- `item-effects.ts`；
- `GATE_STAGE_NAME` / `GATE_KEY_NAME`；
- 物品 use 直接设置 `games.status=completed` 的路径。

物品仍保留稳定 `key`，供内容与后续行为识别；但物品不再决定世界级结果。

## 剩余泄漏清单

### 1. demo 基础数据与内容耦合

位置：`apps/server/src/db/maintenance.ts`

- 从 `seeds/dark-fantasy.ts` 导入 `DEMO_USER`，把“演示用户”与某一份具体内容绑在一起；
- `app_meta` 的 value 写死 `{ version: 1, seed: "dark-fantasy.v2" }`，既是内容专名，也已经过时（当前内容版本是 `dark-fantasy.v10`）。

### 2. CLI 建局默认使用演示内容

位置：`apps/server/scripts/agent-game.ts`

```ts
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
...
world: DARK_FANTASY_WORLD,
```

`create` 没有内容选择入口；而 `new`（快照）已经支持 `--world` / `--world-file`。核心 API 早就能接受任意 `World`，只有 CLI 没有暴露。

### 3. 内容文件同时承载 demo 身份

`seeds/dark-fantasy.ts` 同时导出 `DEMO_USER` 与 `DARK_FANTASY_WORLD`。前者是开发环境的基础设施（登录用户），后者是故事内容。二者生命周期不同，混在一个文件里会鼓励“换故事就得换 demo 用户”。

## 不属于泄漏的部分

- `test/test-world.ts`：测试夹具，刻意与演示内容独立；
- `test/seed-world.test.ts`：直接断言演示内容，属于内容回归测试；
- `prompts/`：从内容生成的只读导出；
- 文档中的场景名与人名：说明与示例，不参与运行时。

## 检查方法

```bash
# 框架层（src/scripts）里是否出现故事专名
grep -rn "铁闸门\|闸门钥匙\|枯钟\|黑疖\|奥德里克\|煤渣\|坏运气\|无名者\|鼠王" \
  apps/server/src apps/server/scripts --include=*.ts

# 框架层是否 import 内容文件
grep -rn "seeds/dark-fantasy" apps/server/src apps/server/scripts --include=*.ts
```

当前第一条只应命中 `scripts/rag-smoke.ts` 的检索测试文本，不应命中 `src`；第二条会命中 `db/maintenance.ts` 与 `scripts/agent-game.ts`。

## 目标模型

**demo 与内容解耦**：

- demo 用户改为环境变量或独立的 demo fixture，不从故事 seed 导入；
- `app_meta` 记录实际 `contentVersion`，不写故事专名。

**CLI 内容选择**：

- `create --world-file <path>`；
- 默认内容只作为显式的 `--demo` 回退，不进入核心服务。

**内容层至少需要表达**：世界宏观设定与规则、场景与场景图、初始位置、角色属性与物品、角色/场景/world 能力、物品 `stats`、内容版本与校验。输入可以是 JSON / YAML / TypeScript seed，但必须经过统一校验后物化为数据库状态；数据库仍是运行时唯一真相。

## 建议的优先级

### P0：world 链路（已完成）

- `World.actions` 与 `worlds.actions`；
- world memory / system prompt / `runWorldTurn`；
- stage `notify_world` 与 `StagePlan.notifications`；
- world `notify_stage` 与 `end_game`；
- `use.targetDetail` 写入 stage memory；
- 移除物品效果与自动通关；
- `agent:game world` 显式推进。

### P1：demo 与 CLI 解耦

- `create --world-file`；默认内容显式化为 demo；
- demo 用户与 `app_meta` 去故事化；
- 内容版本与 `contentVersion` 绑定并校验。

### P2：world 与内容可靠性

- world 通知/指令的 outbox 或确认机制；
- LLM 失败、重复回合与幂等处理；
- world/stage memory 的摘要与上下文压缩；
- 内容校验命令：检查 world/stage/actor/item 能力与引用。

## 验收标准

- `src/game` 中不再出现具体故事名、钥匙名、鼠王、铁闸门等专名；
- actor 不能直接结束游戏；stage 不能直接结束游戏；只有 world 能 `end_game`；
- stage 通知与 world 指令都落入对应 memory；
- 不需要修改服务层就能用另一份 `World` 创建、推进并结束另一段故事；
- CLI 能从内容文件创建游戏；
- 测试能用两个不同世界验证同一套规则；
- 临时测试剧本可以替换或删除，不影响框架。

## 非目标

- 不把数据库改成内容文件数据库；
- 不让内容文件直接写运行时状态；
- 不把 LLM prompt 的全部文本硬编码进服务层；
- 不为每个故事写一套新的 apply 分支；
- 不让 seed 直接注入任意 TypeScript 函数；
- 不在数据库事务内调用 LLM；
- 不让 World 直接覆盖 stage 的 environment；当前只下发 directive。

→ 参见：[数据库](database.md) → 参见：[Stage 小 GM](stage.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md)

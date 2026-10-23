# 数据驱动：边界与当前内容泄漏

> 当前状态：物品使用行为已从动作层迁到内容层；剩余内容泄漏集中在 demo 基础数据与 CLI 默认建局。

## 结论

`World`、`Stage`、`Actor`、`Item` 是系统框架概念；故事文本、角色关系、场景图、物品、角色能力、物品使用效果与通关条件由内容输入提供，不写进 `game` 服务。

当前边界：

- 数据库 schema、领域类型、prompt 组装、动作结算、stage 能力全部与具体故事无关；
- 故事内容集中在 `seeds/dark-fantasy.ts`（枯钟修道院 / 黑疖病）；
- 物品使用采用声明式效果：`ItemDefinition.use` 由内容提供，`use` 动作只负责校验、事件与效果应用；
- 通关条件与完成文案不再硬编码在 `actions/use.ts`；
- 但 **demo 用户与 app_meta、CLI 默认建局**仍然把当前剧本写死在框架层。

数据驱动是持续目标，不是一次性完成状态。

## 当前隔离边界

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 数据库 schema | 已隔离 | 只表达 world / stage / actor / item / message / memory 等通用概念；能力用 `actions` JSONB 承载 |
| 领域类型 | 已隔离 | `World` / `Stage` / `Actor` / `Item` / `ItemUseDefinition` 均为通用容器 |
| 故事内容 | 已隔离到 seed | 场景名、角色与名字、profile、连接、物品、`actions` 能力、环境文本、初始旁白都在 `seeds/dark-fantasy.ts` |
| system prompt | 由内容生成 | 标题、`你扮演角色/场景`、游戏设定、角色/场景设定、全局规则全部来自 `World` 字段与全局规则常量 |
| 执行细节 | 由内容/工具承载 | environment 写法在 `submit_environment` 工具描述里；本轮任务在 observation 里；不进 system prompt |
| 角色与场景能力 | 已隔离 | `actors.actions` 决定 NPC 可用工具；`stages.actions` 决定 stage 小 GM 可用工具 |
| 物品使用行为 | 已隔离 | `ItemDefinition.use` 声明目标限制与效果；`use.ts` 只做通用流程 |
| 通关条件 | 已隔离 | 钥匙在 seed 中声明 `complete_game` 效果，用 `targetStageKey` 与稳定 key 判定 |
| 完成反馈文案 | 已隔离 | 由物品效果的 `message` / `result` 提供，框架只替换占位符 |
| **demo 基础数据** | **有泄漏** | `db/maintenance.ts` 从 seed 导入 `DEMO_USER`，`app_meta` 写死 `dark-fantasy.v2` |
| **CLI 建局入口** | **有泄漏** | `scripts/agent-game.ts` 的 `create` 永远使用 `DARK_FANTASY_WORLD`，`--world-file` 只服务快照 `new` |
| 测试 | 已隔离 | 主要用例使用独立的 `TEST_WORLD`；另有 seed 回归测试直接断言演示内容 |
| 导出产物 | 不属于泄漏 | `prompts/` 是从内容生成的调试旁路，gitignore，数据库仍是运行时唯一真相 |

## 已完成的物品声明式行为

`ItemDefinition` 现在包含：

```ts
{
  key: "gate-key",
  name: "饰品.闸门钥匙",
  description: "...",
  kind: "accessory",
  use: {
    target: "stage",
    targetStageKey: "gate",
    effects: [
      {
        type: "complete_game",
        message: "{actor}用{item}打开了{target}，游戏结束。",
        result: "铁闸门打开了。"
      }
    ]
  }
}
```

运行时分三层：

1. `use.ts` 校验物品归属、目标、存活与场景；
2. 根据 `use.target` / `targetStageKey` 判断物品行为是否接受该目标；
3. `item-effects.ts` 执行 `effects`，当前只实现 `complete_game`。

因此：

- `use.ts` 不再知道“闸门”或“钥匙”；
- 通关判定使用 `stages.key` 与 `items.key`，不用展示名；
- 完成文案由内容提供；
- 普通物品没有 `use` 时仍走通用使用反馈。

### 当前不包含

- 没有通用 handler 注册表；
- 没有 LLM 物品行为；
- 没有物品实例状态（充能、点燃、开关等）；
- 没有在数据库事务内调用 LLM 的设计。

这些能力以后可以沿同一接口扩展，但不能把任意函数直接塞进 seed：数据库是运行时唯一真相，行为必须是可序列化的描述，由框架解释。

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

**内容层至少需要表达**：世界宏观设定与规则、场景与场景图、初始位置、角色属性与物品、`actions` 能力、物品 `stats`、物品使用效果、完成条件与完成文案、内容版本与校验。输入可以是 JSON / YAML / TypeScript seed，但必须经过统一校验后物化为数据库状态；数据库仍是运行时唯一真相。

## 建议的优先级

### P0：物品使用行为去硬编码（已完成）

- `ItemDefinition` / `ItemState` 增加稳定 `key`；
- `stages` 保存稳定 `key`；
- `ItemDefinition.use` 声明目标限制与效果；
- 删除 `GATE_STAGE_NAME` / `GATE_KEY_NAME` 与“铁闸门打开了”框架文案；
- 钥匙通关完全由 seed 的 `use.effects` 驱动；
- 测试用独立的 `sealed-gate` / `sealed-key` 验证同一套 `use` 能通关。

### P1：demo 与 CLI 解耦

- `create --world-file`；默认内容显式化为 demo；
- demo 用户与 `app_meta` 去故事化；
- 内容版本与 `contentVersion` 绑定并校验。

### P2：物品行为词汇表

- 增加 `damage_actor`、`set_environment`、`move_item` 等通用效果；
- 需要复杂逻辑时再引入 handler 注册表；
- LLM 行为独立于数据库事务，输出结构化提案并经过校验；
- 增加内容校验命令，检查物品 key、stage key 引用与效果参数。

## 验收标准

- `src/game` 中不再出现具体故事名、钥匙名、鼠王、铁闸门等专名；
- 通关判定只用稳定 key，重命名内容不会改变行为；
- 不需要修改服务层就能用另一份 `World` 创建、推进并通关另一段故事；
- CLI 能从内容文件创建游戏；
- 测试能用两个不同世界验证同一套规则；
- 临时测试剧本可以替换或删除，不影响框架。

## 非目标

- 不把数据库改成内容文件数据库；
- 不让内容文件直接写运行时状态；
- 不把 LLM prompt 的全部文本硬编码进服务层；
- 不为每个故事写一套新的 apply 分支；
- 不让 seed 直接注入任意 TypeScript 函数；
- 不在数据库事务内调用 LLM。

→ 参见：[数据库](database.md) → 参见：[临时测试剧本](test-scenario.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md)

# 数据驱动：边界与当前内容泄漏

> 目标状态：故事是输入，框架是引擎。核心服务已经接近这个形态，但仍有三类内容泄漏，全部集中在“通关条件、demo 基础数据、CLI 默认内容”。

## 结论

`World`、`Stage`、`Actor`、`Item` 是系统框架概念；故事文本、角色关系、场景图、物品、角色能力与通关条件应当由内容输入提供，而不是写进 `game` 服务。

当前边界：

- 数据库 schema、领域类型、prompt 组装、动作结算、stage 能力全部与具体故事无关；
- 故事内容集中在 `seeds/dark-fantasy.ts`（枯钟修道院 / 黑疖病）；
- 但**通关条件、demo 用户与 app_meta、CLI 默认建局**仍然把当前剧本写死在框架层。

数据驱动是下一步开发目标，不是当前已完成状态。

## 当前隔离边界

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 数据库 schema | 已隔离 | 只表达 world / stage / actor / item / message / memory 等通用概念；能力用 `actions` JSONB 承载 |
| 领域类型 | 已隔离 | `World` / `Stage` / `Actor` / `Item` / `Weapon` 均为通用容器 |
| 故事内容 | 已隔离到 seed | 场景名、角色与名字、profile、连接、物品、`actions` 能力、环境文本、初始旁白都在 `seeds/dark-fantasy.ts` |
| system prompt | 由内容生成 | 标题、`你扮演角色/场景`、游戏设定、角色/场景设定、全局规则全部来自 `World` 字段与全局规则常量 |
| 执行细节 | 由内容/工具承载 | environment 写法在 `submit_environment` 工具描述里；本轮任务在 observation 里；不进 system prompt |
| 角色与场景能力 | 已隔离 | `actors.actions` 决定 NPC 可用工具；`stages.actions` 决定 stage 小 GM 可用工具 |
| **通关条件** | **有泄漏** | `actions/use.ts` 直接引用当前剧本的 stage 名与物品名 |
| **完成反馈文案** | **有泄漏** | `actions/use.ts` 写死“铁闸门打开了。” |
| **demo 基础数据** | **有泄漏** | `db/maintenance.ts` 从 seed 导入 `DEMO_USER`，`app_meta` 写死 `dark-fantasy.v2` |
| **CLI 建局入口** | **有泄漏** | `scripts/agent-game.ts` 的 `create` 永远使用 `DARK_FANTASY_WORLD`，`--world-file` 只服务快照 `new` |
| 测试 | 已隔离 | 主要用例使用独立的 `TEST_WORLD`；另有 seed 回归测试直接断言演示内容 |
| 导出产物 | 不属于泄漏 | `prompts/` 是从内容生成的调试旁路，gitignore，数据库仍是运行时唯一真相 |

## 泄漏清单

### 1. 通关条件写死在动作层

位置：`apps/server/src/game/actions/use.ts:11-13`

```ts
export const GATE_STAGE_NAME = "场景.铁闸门";
export const GATE_KEY_NAME = "饰品.闸门钥匙";
```

判定：`use.ts:135`

```ts
const completed = targetStage?.name === GATE_STAGE_NAME && item.name === GATE_KEY_NAME;
```

问题有两层：

- **内容泄漏**：框架层知道了当前故事的具体场景名与物品名；
- **稳定性风险**：匹配用的是展示名（`name`），不是稳定 key / id。改名（比如从“封骨之门”改为“铁闸门”）必须同步改框架常量，否则会静默失去通关能力。

同时这两个常量被测试直接 import（`test/items-and-interactions.test.ts:20`），等于把泄漏固化成框架 API。

### 2. 完成反馈文案写死

位置：`use.ts:147`

```ts
return `# 行动结果\n你对${targetLabel}使用了${item.name}。${completed ? "\n铁闸门打开了。" : ""}`;
```

“门打开了”属于内容文案，不属于 `use` 动作的通用反馈。

### 3. demo 基础数据与内容耦合

位置：`apps/server/src/db/maintenance.ts:2,48-65`

- 从 `seeds/dark-fantasy.ts` 导入 `DEMO_USER`，把“演示用户”与某一份具体内容绑在一起；
- `app_meta` 的 value 写死 `{ version: 1, seed: "dark-fantasy.v2" }`，既是内容专名，也已经**过时**（当前是 `dark-fantasy.v10`）。

### 4. CLI 建局默认使用演示内容

位置：`apps/server/scripts/agent-game.ts:10,219`

```ts
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
...
world: DARK_FANTASY_WORLD,
```

`create` 没有内容选择入口；而 `new`（快照）已经支持 `--world` / `--world-file`。核心 API 早就能接受任意 `World`，只有 CLI 没有暴露。

### 5. 内容文件同时承载 demo 身份

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

当前第一条会命中 `actions/use.ts`，第二条会命中 `db/maintenance.ts` 与 `scripts/agent-game.ts`。

## 目标模型

下一步优先把内容层补齐，而不是继续往 `apply` 加故事判断。

**通关条件进 `World`**：

- `stages[].completion?: { requiresItemKey, onComplete }` 或等价的 world 级条件；
- 判定用稳定 key（`stage.key` + `item.key`），不用展示名；
- 完成事件文案由内容提供，框架只拼接角色/物品名。

**demo 与内容解耦**：

- demo 用户改为环境变量或独立的 demo fixture，不从故事 seed 导入；
- `app_meta` 记录实际 `contentVersion`，不写故事专名。

**CLI 内容选择**：

- `create --world-file <path>`；
- 默认内容只作为显式的 `--demo` 回退，不进入核心服务。

**内容层至少需要表达**：世界宏观设定与规则、场景与场景图、初始位置、角色属性与物品、`actions` 能力、物品 `stats`（damage / block）、完成条件与完成文案、内容版本与校验。输入可以是 JSON / YAML / TypeScript seed，但必须经过统一校验后物化为数据库状态；数据库仍是运行时唯一真相。

## 建议的优先级

### P0：把通关条件移出框架

- `World` 增加完成条件与完成文案；
- 判定改用稳定 key；
- 删除 `GATE_STAGE_NAME` / `GATE_KEY_NAME` 与“铁闸门打开了”反馈；
- 增加一个与枯钟修道院无关的最小内容 fixture，验证不改服务层即可通关。

### P1：demo 与 CLI 解耦

- `create --world-file`；默认内容显式化为 demo；
- demo 用户与 `app_meta` 去故事化；
- 内容版本与 `contentVersion` 绑定并校验。

### P2：内容包与工具链

- 内容目录/包组织与校验命令；
- 正式内容、临时测试内容、demo 内容分离生命周期；
- 内容与测试夹具分离。

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
- 不为每个故事写一套新的 apply 分支。

→ 参见：[数据库](database.md) → 参见：[临时测试剧本](test-scenario.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md)

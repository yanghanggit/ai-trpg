# 数据驱动：边界与内容体系

> 当前状态：故事内容不再写入框架层。内容通过显式注册表或外部文件进入，`src` 与 `scripts` 中不再出现故事专名，也不再有隐式 demo 内容回退。

## 结论

`World`、`Stage`、`Actor`、`ItemDefinition` 是内容定义；`WorldState`、`StageState`、`ActorState`、`ItemState` 是运行时状态。故事文本、角色关系、场景图、物品、能力与使用描述由内容输入提供，不写进 `game` 服务。

当前边界：

- 数据库 schema、领域类型、prompt 组装、动作结算、stage/world 能力全部与具体故事无关；
- 故事内容集中在 `seeds/dark-fantasy.ts` 与 `seeds/knowledge/dark-fantasy.ts`，通过 `seeds/index.ts` 注册；
- `use` 对场景可以携带 `targetDetail`，它只是 actor 的行动描述，写入 stage memory；
- `attack` / `use` 只做 dispatcher；物品通过 `item.effect` 声明 `event` / `damage` 等效果；
- `actor.openingBriefing` 是本局开局注入给角色的私有简报；建局时写成 actor memory 的第一条 human message，不进入数据库字段；
- `item.affixes` 是词缀数组；默认 effect 执行后，affix agent 在事务外调用 LLM 与工具，再落账补充效果；
- stage 可以用 `notify_world` 把报告写入 world memory；
- world 可以用 `notify_stage` 下发裁决，用 `end_game` 结束游戏；默认玩家角色死亡时由系统触发结束；
- demo 用户是独立 fixture，`app_meta` 不记录故事名；
- CLI 建局必须显式选择内容：`--seed`、`--world-file` 或 `--world`。

## 当前隔离边界

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 数据库 schema | 已隔离 | world / stage / actor / item / message / memory 等通用概念；能力用 `actions` JSONB 承载 |
| 领域类型 | 已隔离 | `World` / `Stage` / `Actor` / `ItemDefinition` 是内容定义；`WorldState` / `StageState` / `ActorState` / `ItemState` 是运行时状态 |
| 内容校验 | 已隔离 | `parseWorldContent` 在建局前校验外部内容；缺能力、缺 key、类型错误直接拒绝 |
| 故事内容 | 已隔离到 seed | 场景、角色、profile、openingBriefing、连接、物品、能力、环境、初始旁白在内容文件 |
| 内容注册 | 显式 | `seeds/index.ts` 只做显式 `name → { world, knowledge }` 映射，不写默认故事 |
| system prompt | 由内容生成 | 角色、场景与 world 的身份、设定与全局规则来自 `World` 字段；actor 的 `openingBriefing` 另以 human message 注入 memory |
| 执行细节 | 由内容/工具承载 | environment 写法在 `submit_environment` 描述里；通知与结束规则在 stage/world 工具描述里 |
| 角色与场景能力 | 已隔离 | `actors.actions` / `stages.actions` 决定 NPC 与 stage 工具 |
| world 能力 | 已隔离 | `World.actions` 决定 world 可用的 `notify_stage` / `end_game` |
| 物品使用 | 已 item-centric | 物品有身份、描述、分类、数值与声明式 `effect`；`attack` / `use` 只按 `effect.type` 分派 |
| 通关条件 | 已移出框架 | 只有 world 能 `end_game`；默认玩家角色死亡是系统终止条件 |
| demo 用户 | 已隔离 | `src/db/demo-fixture.ts`，不依赖任何故事 seed |
| `app_meta` | 已隔离 | 只记录 `{ version: 1, fixture: "demo-user" }`，不写故事名 |
| CLI 建局 | 已隔离 | `create` 必须显式给 `--seed` / `--world-file` / `--world`，没有隐式默认 |
| RAG CLI | 已隔离 | `--seed` 从内容注册表读取；也可以直接 `--collection` 检索，不再写死演示 seed |
| 测试 | 已隔离 | 主要用例使用独立的 `TEST_WORLD`；演示 seed 回归单独存在 |
| 导出产物 | 不属于泄漏 | `prompts/` 是从内容生成的调试旁路，gitignore，数据库仍是运行时唯一真相 |

## 当前行动链路

```text
actor attack(itemName?) / use(itemName, target)
  → attack / use dispatcher：选物品、校验目标、读取 item.effect
  → effect handler：先执行默认 effect
  → affix agent：有词缀时再执行事务外 LLM + 工具补充效果
  → use 的 event 写入 stage memory，交给 stage 判断本地后果
  → notify_world：把场景报告写入 world memory
  → world 回合：裁决世界级事实
  → notify_stage：把裁决写入 stage memory
  → end_game：只有 world 主动结束游戏；默认玩家角色死亡由系统终止
```

关键边界：

- `item.effect` 是可序列化声明，不是函数；执行器按 `type` 注册；
- `attack` / `use` 不内嵌具体效果公式；武器伤害在 `damage` effect 中；
- `targetDetail` 是行动声明，不是既成事实；
- stage 报告是报告，不是世界事实，也不是系统指令；
- world 不直接替 stage 写 environment；它下发 directive，由 stage 下一回合解释；
- 所有 LLM 调用都在数据库事务之外；stage/world 回合分别显式推进。

## 内容入口

### 注册内容

`seeds/index.ts` 暴露：

```ts
CONTENT_SEEDS["dark-fantasy"] // { world, knowledge }
getContentSeed("dark-fantasy")
```

注册表只负责明确映射，不提供隐式默认值。

### 从 seed 建局

```bash
pnpm agent:game create --user demo --seed dark-fantasy --slug my-game
```

### 从文件建局

```bash
pnpm agent:game create --user demo --world-file ./world.json --slug my-game
```

外部内容经过 `parseWorldContent` 校验后才会进入 `createGame`。

### RAG

```bash
pnpm rag ingest --seed dark-fantasy
pnpm rag search --seed dark-fantasy --query "..."
pnpm rag search --collection "world:<世界名>:<内容版本>" --query "..."
```

`rag:smoke` 从内容注册表中取第一份知识，不再写死故事名或问题。

## Agent Game 入口的当前能力与边界

结论：从 `agent:game` 入口选择内容、建局、推进 actor/stage/world、通知和结束游戏，主链路已经可用；但它是**显式多回合 CLI 流程**，不是隐式自动编排。

| 环节 | 入口 | 状态 |
| --- | --- | --- |
| 选择内容 / 构建数据 | `create --seed`、`--world-file`、`--world` | 可用；`--seed` 从内容注册表读取，外部文件经过 `parseWorldContent` 校验 |
| 建局物化 | `createGame` | 写入 world / stage / actor / item / message / agent memory |
| actor 推进 | `npc` 或 `player-*` | 可用 |
| stage 推进 | `stage`，含 `notify_world` | 可用 |
| world 推进 | `world`，含 `notify_stage` / `end_game` | 可用 |
| 结束游戏 | ① world 的 `end_game`（如钥匙开门）；② 默认玩家角色死亡 | ① world 主动结束；② 默认玩家角色死亡由系统置 `games.status = completed` |
| RAG 内容 | `rag ingest --seed` / `rag search --collection` | 可用，但建局时不会自动 ingest |

### 典型流程

```bash
pnpm agent:game create --user demo --seed dark-fantasy --slug my-game

pnpm agent:game take-control --game my-game --actor "角色.无名者"
pnpm agent:game player-use --game my-game --actor "角色.无名者" \
  --item "饰品.闸门钥匙" --stage "场景.铁闸门" --detail "锁孔"

pnpm agent:game stage --game my-game --stage "场景.铁闸门"
pnpm agent:game world --game my-game
pnpm agent:game status --game my-game
```

### 使用提示

1. **stage / world 不会自动运行**  
   必须显式执行 `stage` 和 `world`。这是有意的，避免在数据库事务内自动调用 LLM。

2. **没有隐式内容默认值**  
   `create` 必须显式提供 `--seed`、`--world-file` 或 `--world`；缺失会报错。当前注册表只有已注册的内容名称，任意新内容用 JSON 文件或先加入注册表。

3. **`--world-file` 当前接收 JSON**  
   不直接加载 TypeScript seed；TS seed 通过 `seeds/index.ts` 注册。

4. **RAG 不会在建局时自动执行**  
   新世界若要支持 `query`，需要单独执行 `pnpm rag ingest --seed <name>`，并确保 collection 与游戏内容版本一致；工具对所有 actor 开放，不需要按角色声明。

5. **旧局不自动升级**  
   在 world memory / `worlds.actions` / stage `notify_world` 之前创建的旧游戏，需要新建一局；旧局不会自动获得新结构。

6. **结束依赖 world LLM 判断**  
   引擎保证 actor/stage 不能直接调用 `end_game`，但 world 是否在本轮调用 `end_game` 仍由模型和内容提示决定；默认玩家角色死亡则由系统确定性结束。

7. **`targetDetail` 是行动描述，不是结果**  
   它帮助 stage 判断使用部位；装饰、铭文、表面纹样不应被推测为隐藏机关，普通表面行动只更新 environment。

## 已移除的旧模型

- `CompleteGameEffect` / 函数式 `ItemUseEffect` / `ItemUseDefinition`；
- `item.use` / `item.effects` 直接执行路径；
- 旧 `item-effects.ts`；
- `GATE_STAGE_NAME` / `GATE_KEY_NAME`；
- 物品 use 直接设置 `games.status=completed` 的路径；
- `DEMO_USER` 与 `app_meta` 的故事耦合；
- CLI `create` 的隐式 `DARK_FANTASY_WORLD`；
- `src` / `scripts` 对具体故事 seed 的静态 import。

物品仍保留稳定 `key`；新的 `item.effect` 只声明效果，不直接改变世界级状态。世界级后果仍由 stage / world 裁决。

## 检查方法

```bash
# 框架层（src/scripts）里是否出现故事专名
grep -rn "铁闸门\|闸门钥匙\|枯钟\|黑疖\|奥德里克\|煤渣\|坏运气\|无名者\|鼠王" \
  apps/server/src apps/server/scripts --include=*.ts

# 框架层是否直接 import 内容文件
grep -rn "seeds/dark-fantasy" apps/server/src apps/server/scripts --include=*.ts

# 框架层是否静态引用具体世界观
grep -rn "DARK_FANTASY_WORLD" apps/server/src apps/server/scripts --include=*.ts
```

前三条都应为空；`DEMO_USER` 只允许存在于通用 demo fixture 与 maintenance 中，不属于故事内容。内容注册表与故事 seed 只在 `apps/server/seeds/` 内互相引用。

## 目标模型

**内容包**：

- `seeds/index.ts` 作为显式内容注册表；
- 未来可把内容组织为独立目录/包，并提供导出与校验命令；
- 内容文件可以是 TypeScript seed 或 JSON；进入 `createGame` 前统一经过 `parseWorldContent`。

**world 与内容可靠性**：

- world 通知/指令的 outbox 或确认机制；
- LLM 失败、重复回合与幂等处理；
- world/stage memory 的摘要与上下文压缩；
- 内容校验命令：检查 world/stage/actor/item 能力与引用。

## 建议的优先级

### P0：world 链路（已完成）

- `World.actions` 与 `worlds.actions`；
- world memory / system prompt / `runWorldTurn`；
- stage `notify_world` 与 `StagePlan.actions`；
- world `notify_stage` 与 `end_game`；
- `use.targetDetail` 写入 stage memory；
- 移除物品直接通关；改为 `item.effect` 声明式效果 + dispatcher；
- `agent:game world` 显式推进。

### P1：内容入口去耦合（已完成）

- demo 用户移到独立 fixture；
- `app_meta` 去故事化；
- `create --seed` / `--world-file` / `--world`；
- RAG 使用内容注册表，不写死演示 seed；
- `parseWorldContent` 内容校验；
- `src` / `scripts` 不再 import 具体故事 seed。

### P2：world 与内容可靠性

- world 通知/指令的 outbox 或确认机制；
- LLM 失败、重复回合与幂等处理；
- world/stage memory 摘要与压缩；
- 内容包目录与校验命令。

## 验收标准

- `src/game` 与 `scripts` 中不再出现具体故事名、钥匙名、鼠王、铁闸门等专名；
- `src/game` 与 `scripts` 不再直接 import 具体故事 seed；
- `create` 没有隐式内容默认值；
- `app_meta` 不记录故事名；
- actor 不能直接调用 `end_game`；stage 也不能；只有 world 能主动 `end_game`。默认玩家角色死亡由系统终结；
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

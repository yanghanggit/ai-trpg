# 数据驱动：边界与内容体系

> 当前状态：故事内容不再写入框架层。内容通过显式注册表或外部文件进入，`src` 与 `scripts` 中不出现故事专名，也没有隐式 demo 内容回退。

## 结论

`World`、`Stage`、`Actor`、`ItemDefinition` 是内容定义；`WorldState`、`StageState`、`ActorState`、`ItemState` 是运行时状态。故事文本、角色关系、场景图、物品、能力与使用描述由内容输入提供，不写进 `game` 服务。内容输入的单位是**内容包** `{ world, knowledge }`：`seeds/` 只是内置内容包的一个 provider，外部 JSON 走同一个契约。

框架层保持内容无关：数据库 schema、领域类型、prompt 组装、动作结算、stage/world 能力都不含具体故事知识。场景与角色能做什么由内容里的 `actions` 声明，运行时以数据库为准。

内容集中在 `seeds/dark-fantasy/`：`campaign.ts` 是不可变的战役文本（`campaignSetting` / `systemRules`），每个剧本一个文件，知识库与剧本 1:1 绑在同目录（`<剧本>.knowledge.ts`），检索评测集同目录（`<剧本>.eval.ts`，由 `seeds/eval.ts` 注册），`index.ts` 用 `assembleWorld()` 拼成 `World`，最后由 `seeds/index.ts` 注册为 `ContentPack`。

## 隔离边界

- **数据库 schema**：world / stage / actor / item / message / memory 等通用概念；能力用 `actions` JSONB 承载。
- **内容校验**：`parseContentPack` 校验内容包，`parseWorldContent` 校验世界内容；缺能力、缺 key、类型错误直接拒绝。所有场景必须声明 `submit_environment`。
- **system prompt**：身份、设定与全局规则来自 `World` 字段；actor 的 `openingBriefing` 以 human message 注入 memory，不是数据库字段。
- **执行细节**：environment 写法在工具描述里，通知与结束规则在 stage/world 工具描述里；prompt 里不举具体故事样例。
- **结束条件**：只有 world 能 `end_game`；默认玩家角色死亡由系统确定性结束。
- **demo 用户与 `app_meta`**：独立 fixture，只记录 `{ version: 1, fixture: "demo-user" }`，不写故事名。
- **CLI 建局**：必须显式给 `--seed`、`--content-file`、`--world-file` 或 `--world`，没有默认故事。
- **RAG**：`--seed` 从内容注册表读取，也可直接 `--collection` 检索；建局不会自动 ingest。
- **测试**：主要用例使用独立的 `TEST_WORLD`；演示 seed 的回归单独存在。
- **导出产物**：`prompts/` 是从内容生成的调试旁路，gitignore；数据库仍是运行时唯一真相。

`item.effect` 是声明式可序列化效果，`attack` / `use` 只按 `type` 分派；武器伤害在 `damage` effect 中，`targetDetail` 是行动声明而非既成事实。stage 报告是报告，不是世界事实；world 不直接替 stage 写 environment，只下发 directive。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、→ 参见：[Stage 小 GM](stage.md)

## 内容入口

`seeds/index.ts` 暴露 `CONTENT_PACKS` 与 `getContentPack(name)`，只做显式 `name → { world, knowledge }` 映射，不提供隐式默认值。

从内置内容建局：`pnpm agent:game create --user demo --seed dark-fantasy --slug my-game`。

从文件建局：`pnpm agent:game create --user demo --content-file ./pack.json --slug my-game`，内容包与 seed 等价；`--world-file ./world.json` 只提供 world，该世界没有公共知识。外部内容先经 `parseContentPack` / `parseWorldContent` 校验才进入 `createGame`；知识库用 `pnpm rag ingest --file ./pack.json` 显式同步，不随建局自动入库。

检索侧：`pnpm rag ingest --seed dark-fantasy`、`pnpm rag search --seed dark-fantasy --query "..."`、`pnpm rag check --seed dark-fantasy`；`rag:smoke` 从注册表取样本，不写死故事名。

→ 参见：[公共知识检索](rag.md)、→ 参见：[开发期 Agent 工作流](debug-workflow.md)

## 检查方法

这条约束由 `apps/server/test/prompt-genericity.test.ts` 自动守卫：从当前 seed 取出角色、场景、物品专名，扫描框架层源码，并拒绝具体机构部件样例词。

手工复核时，把当前 seed 的专名拼成 `"专名1\|专名2"` 传给 `grep -rn <pattern> apps/server/src apps/server/scripts --include=*.ts`；再检查 `seeds/dark-fantasy` 与 `BELL_MONASTERY_WORLD` 是否出现在框架层。两者都应为空。`DEMO_USER` 只允许存在于通用 demo fixture 与 maintenance。

## 目标模型

- **内容包**：`seeds/index.ts` 作为显式注册表；内容可组织为独立目录或包，并提供导出与校验命令；进入 `createGame` 前统一经过 `parseWorldContent`。
- **world 与可靠性**：通知/指令的 outbox 或确认机制、LLM 失败与重复回合的幂等处理、world/stage memory 的摘要与压缩、内容能力与引用的校验命令。

## 非目标

- 不把数据库改成内容文件数据库；
- 不让内容文件直接写运行时状态；
- 不把 LLM prompt 全部文本硬编码进服务层；
- 不为每个故事写一套新的 apply 分支；
- 不让 seed 注入任意 TypeScript 函数；
- 不在数据库事务内调用 LLM；
- 不让 World 直接覆盖 stage 的 environment。

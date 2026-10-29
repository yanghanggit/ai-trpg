# 数据驱动：边界与内容体系

> 当前状态：故事内容不再写入框架层。内容通过显式注册表或外部文件进入，`src` 与 `scripts` 中不出现故事专名，也没有隐式 demo 内容回退。

## 结论

`World`、`Stage`、`Actor`、`ItemDefinition` 是内容定义；`WorldState`、`StageState`、`ActorState`、`ItemState` 是运行时状态。故事文本、角色关系、场景图、物品、能力与使用描述由内容输入提供，不写进 `game` 服务。内容输入的单位是**内容包** `{ world, knowledge }`：`seeds/` 只是内置内容包的一个 provider，外部 JSON 走同一个契约。

术语上，一个 `World` 就是一局故事的世界，基本等于一个剧本；`campaignSetting` / `systemRules` 所在的 `Campaign` 才是跨剧本共用的大世界观，`assembleWorld()` 把战役文本套到剧本上，所以剧本不能覆盖这两段。

框架层保持内容无关：数据库 schema、领域类型、prompt 组装、动作结算、stage / world 能力都不含具体故事知识；场景与角色能做什么由内容里的 `actions` 声明，运行时以数据库为准。

内容无关不等于内容缺席：`campaignSetting` 必须进每个会推理的运行时 agent。

→ 参见：[LLM 基础组件](llm.md)

内容集中在 `seeds/dark-fantasy/`：`campaign.ts` 是不可变的战役文本，每个剧本一个文件，知识库与检索评测集同目录 1:1 绑定，`index.ts` 用 `assembleWorld()` 拼成 `World`，最后由 `seeds/index.ts` 注册为 `ContentPack`。

## 隔离边界

- **数据库 schema**：只放 world / stage / actor / presentation / item / message / memory 等通用概念，能力用 `actions` JSONB 承载。
- **内容校验**：`parseContentPack` 校验内容包，`parseWorldContent` 校验世界内容，缺能力、缺 key、类型错误直接拒绝；所有场景必须声明 `submit_environment`。
- **prompt 里没有故事样例，也没有工具名**：身份、设定与全局规则来自 `World` 字段，但不写工具名——工具会改名，内容不该跟着改；写法细则在工具描述里。守卫见「检查方法」。
- **结束条件**：只有 world 能 `end_game`，`outcome` 由它自己命名，框架不枚举；主角死亡也只是一条通知 world 的事实。收束判据属于内容：通用判断规则在 `systemRules`，本剧本对世界与收束的理解在 world 的 `profile`。
- **demo 用户与 `app_meta`**：独立 fixture，只记录 `{ version: 1, fixture: "demo-user" }`，不写故事名。
- **CLI 建局**：必须显式给内容来源，没有默认故事；RAG 同理，建局不会自动 ingest。
- **测试**：主要用例使用独立的 `TEST_WORLD`，演示 seed 的回归单独存在。
- **导出产物**：`prompts/` 是从内容生成的调试旁路，gitignore；数据库仍是运行时唯一真相。

`item.effect` 是声明式可序列化效果，`strike` / `use` 只按 `type` 分派；物品还能声明 `actions`，把 `strike` 这类动作借给穿戴它的角色；stage 报告是报告、不是世界事实；world 不直接替 stage 写 environment，只下发 directive。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、→ 参见：[Stage 小 GM](stage.md)、[Seed 内容编写原则](seed-authoring.md)

## 内容入口

`seeds/index.ts` 暴露 `CONTENT_PACKS` 与 `getContentPack(name)`，只做显式 `name → { world, knowledge }` 映射，不提供隐式默认值。

建局必须显式给内容来源，没有默认故事：内置 seed、外部内容包（与 seed 等价）或只给 world 文件（该世界没有公共知识）。外部内容先经 `parseContentPack` / `parseWorldContent` 校验才进入 `createGame`；知识库要另外显式 ingest，不随建局自动入库。

→ 参见：[公共知识检索](rag.md)、→ 参见：[开发期 Agent 工作流](debug-workflow.md)

## 检查方法

两条约束由测试守：`apps/server/test/prompt-genericity.test.ts` 取出当前 seed 的角色、场景、物品专名去扫描框架层源码，并拒绝具体机构部件与题材化样例词；`apps/server/test/system-prompt-tool-names.test.ts` 生成两份世界的全部 system prompt，拒绝其中的小写 snake_case 词（工具名都是这种形状），内容里合法的领域词走白名单、不放宽规则。

测试只能守住已知词表，未知题材的判断交给开发期的语义审查工具：它只读框架源码里的字面文本（运行时插值折叠成占位符），让内部审查 agent 判断同一段话换到别的题材是否仍成立；结论按内容缓存，也可以只看改动过的文件。它不进入测试套件——测试保持确定性、离线与零成本。

手工复核时，把当前 seed 的专名拼成正则传给 `grep -rn` 扫 `apps/server/src` 与 `apps/server/scripts`，再确认 `seeds/dark-fantasy` 与 `BELL_MONASTERY_WORLD` 没有出现在框架层；两者都应为空。`DEMO_USER` 只允许存在于通用 demo fixture 与 maintenance。

## 目标模型

- **内容包**：`seeds/index.ts` 作为显式注册表；内容可组织为独立目录或包，并提供导出与校验命令；进入 `createGame` 前统一经过 `parseWorldContent`。
- **world 与可靠性**：通知 / 指令的 outbox 或确认机制、LLM 失败与重复回合的幂等处理、world / stage memory 的摘要与压缩、内容能力与引用的校验命令。

## 非目标

- 不把数据库改成内容文件数据库；
- 不让内容文件直接写运行时状态；
- 不把 LLM prompt 全部文本硬编码进服务层；
- 不为每个故事写一套新的 apply 分支；
- 不让 seed 注入任意 TypeScript 函数；
- 不在数据库事务内调用 LLM；
- 不让 World 直接覆盖 stage 的 environment。

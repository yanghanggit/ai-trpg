# 数据驱动：边界与内容体系

> 当前状态：故事内容不再写入框架层。内容通过显式注册表或外部文件进入，`src` 与 `scripts` 中不出现故事专名，也没有隐式 demo 内容回退。

## 结论

`World`、`Stage`、`Actor`、`ItemDefinition` 是内容定义；`WorldState`、`StageState`、`ActorState`、`ItemState` 是运行时状态。故事文本、角色关系、舞台图、道具、能力与使用描述由内容输入提供，不写进 `game` 服务。内容输入的单位是**内容包** `{ world, knowledge }`：`seeds/` 只是内置内容包的一个 provider，外部 JSON 走同一个契约。知识条目可以带访问标签，actor 内容声明自己具备的标签；建局时标签随 actor 物化，检索按它过滤。

术语上，一个 `World` 就是一局故事的世界，基本等于一个剧本；跨剧本共用的是**战役内容**：战役设定（题材与边界）与世界职能口径（词缀、故事、压缩、对话审核各自在本题材下的规矩与口味），剧本不能覆盖它们，只能按条覆盖职能口径。全局规则另属一层：它描述的是引擎已有的事实（游戏实体、名字与引用、舞台跳跃），对所有游戏内实体共同成立，所有战役共用，只有一个所有者。数值的含义在 `get_self` 与攻击工具的契约里，换算与对抗归玩法数值层，知识来源由检索工具自己说明，都不在全局规则里。

框架层保持内容无关：数据库 schema、领域类型、prompt 组装、动作结算、stage / world 能力都不含具体故事知识；舞台与角色能做什么由内容里的 `actions` 声明，运行时以数据库为准。

内容无关不等于内容缺席：`campaignSetting` 必须进每个会推理的运行时 agent。

→ 参见：[Agent 与工具](agents.md)

内容集中在 `seeds/dark-fantasy/`：`campaign.ts` 写跨剧本的战役设定，`agents/` 下一个文件一个世界职能 agent（文本、职责与不可协商的约束同处一处），全局规则（global rules）在 `seeds/global-rules.ts`，每个剧本一个文件，知识库与检索评测集同目录 1:1 绑定，`index.ts` 用 `assembleWorld()` 拼成 `World`，最后由 `seeds/index.ts` 注册为 `ContentPack`。世界职能的宪法由剧本自己定档，`assembleWorld()` 只补战役级字段、不代劳写内容；框架只校验它确实带上了这一局的设定与规则。

## 隔离边界

- **数据库 schema**：只放 world / stage / actor / signature / item / message / memory 等通用概念，能力用 `actions` JSONB 承载。
- **内容校验**：`parseContentPack` 校验内容包，`parseWorldContent` 校验世界内容，缺能力、缺 key、类型错误直接拒绝；所有舞台必须声明 `submit_environment`。
- **prompt 里没有故事样例，也没有工具名**：身份、设定与全局规则来自 `World` 字段，但不写工具名——工具会改名，内容不该跟着改；写法细则按层级放：动作规则在工具描述，流程在任务提示词，长期约束在 system prompt。守卫见「检查方法」。
- **结束条件**：只有 world 能 `end_game`，`outcome` 由它自己命名，框架不枚举；主角死亡也只是一条通知 world 的事实。收束判据属于内容：本剧本对世界与收束的理解写在 world 的 `profile` 里。
- **状态词归引擎，材质词归内容**：死亡、伤害、穿戴这类状态跨题材通用，可以留在框架（判据见「题材包络」）；血还是漏液、伤口还是裂口、衣袍还是外壳，属于内容，只从形态与记忆里来——引擎的任务提示词给维度（姿态、表面与结构、装备位置、与周围接触之处），不点名材质。
- **职能口径可以下放，判定程序不行**：世界职能的口径归内容（可以写「这类世界允许黑暗与暴力」），类别枚举、参数与平台级禁令留在代码——否则改一份 seeds 就能改写审核器。
- **demo 用户与 `app_meta`**：独立 fixture，只记录 `{ version: 1, fixture: "demo-user" }`，不写故事名。
- **CLI 建局**：必须显式给内容来源，没有默认故事；RAG 同理，建局不会自动 ingest。
- **测试**：主要用例使用独立的 `TEST_WORLD`，演示 seed 的回归单独存在。
- **导出产物**：`logs/prompts/` 是从内容生成的调试旁路，gitignore；数据库仍是运行时唯一真相。

道具按触发声明静态与推理词缀，挥击与使用各自取自己的列表；道具还能把动作借给穿戴它的角色；stage 报告是报告、不是世界事实；world 不直接替 stage 写 environment，只下发 directive。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、[舞台](stage.md)、[Seed 内容编写原则](seed-authoring.md)

## 题材包络

框架面向 RPG，但「RPG」当不了判据：现代都市、科幻与经营类 RPG 都叫 RPG，却没有剑、没有尸体搜刮、也没有真名传送。可执行的判据是本框架声明的子集——**包络**。它由引擎定义，内容包只能开关其中的能力，不能改写包络本身：

- 角色有身体，有可结算的数值与存活状态；
- 道具有归属与穿戴槽，武器能把动作借给穿戴者；
- 世界是舞台图，有相邻移动与位移；
- 冲突可以致命，死亡留下尸体与遗物；
- 认知会漂移：称呼由观察者自己记，路线会过时；
- 超自然能力不默认存在，由内容开关。

包络之内，词只要指机制就通用，即使词面带某类题材的味道：`brawl`（肉搏）、`steal`（窃取）、`strike` / `cleave`（挥击 / 横扫）、`teleport`（真名、禁传）描述的都是机制——内容包能换的只有「开不开这个能力」，换不掉这些词指的机制。工具名是标识符而不是散文：提示词里出现 `brawl`，是因为模型必须按这个名字调用工具。

包络之外才是泄漏：专名、特有材料、特有机关部件、特有效果或伤害分类、特有职业与机构——一个内容包能定义、另一个内容包能替换的东西。判据一句话：词指的是机制，通过；词指的是某个内容包的实例，泄漏。

机制词汇表只有一个所有者（`mechanism-terms.ts`）：语义审查注入它，确定性测试对照它，两处不各写一张。

## 内容入口

`seeds/index.ts` 暴露 `CONTENT_PACKS` 与 `getContentPack(name)`，只做显式 `name → { world, knowledge }` 映射，不提供隐式默认值。

建局必须显式给内容来源，没有默认故事：内置 seed、外部内容包（与 seed 等价）或只给 world 文件（该世界没有知识库）。外部内容先经 `parseContentPack` / `parseWorldContent` 校验才进入 `createGame`；知识库要另外显式 ingest，不随建局自动入库。

→ 参见：[世界知识检索](rag.md)、[开发期 Agent 工作流](debug-workflow.md)

## 检查方法

两条约束由测试守：`apps/server/test/prompt-genericity.test.ts` 取出当前 seed 的角色、舞台、道具专名去扫描框架层源码，并拒绝具体机构部件与题材化样例词；`apps/server/test/system-prompt-tool-names.test.ts` 生成两份世界的全部 system prompt，拒绝其中的小写 snake_case 词（工具名都是这种形状），内容里合法的领域词走白名单、不放宽规则。

测试只能守住已知词表，未知题材的判断交给开发期的语义审查工具：它只读框架源码里的字面文本（运行时插值折叠成占位符），让内部审查 agent 按「题材包络」判断这段文字是否依赖了某个内容包的实例，并注入机制词汇表；结论按内容缓存，也可以只看改动过的文件。它不进入测试套件——测试保持确定性、离线与零成本。

手工复核时，把当前 seed 的专名拼成正则传给 `grep -rn` 扫 `apps/server/src` 与 `apps/server/scripts`，再确认 `seeds/dark-fantasy` 与 `BELL_MONASTERY_WORLD` 没有出现在框架层；两者都应为空。`DEMO_USER` 只允许存在于通用 demo fixture 与 maintenance。

## 目标模型

- **内容包**：`seeds/index.ts` 作为显式注册表；内容可组织为独立目录或包，并提供导出与校验命令；进入 `createGame` 前统一经过 `parseWorldContent`。
- **world 与可靠性**：通知 / 指令的 outbox 或确认机制、LLM 失败与重复回合的幂等处理、world / stage memory 的摘要与压缩、内容能力与引用的校验命令。

## 非目标

- 不把数据库改成内容文件数据库；
- 不让内容文件直接写运行时状态；
- 不把 LLM prompt 全部文本硬编码进服务层；
- 不为每个故事写一套新的执行分支；
- 不让 seed 注入任意 TypeScript 函数；
- 不在数据库事务内调用 LLM；
- 不让 World 直接覆盖 stage 的 environment。

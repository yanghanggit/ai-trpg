# 架构与契约

## 包职责

- `@ai-trpg/server`：路由、校验、事务与业务规则；`game` 服务层承载 game 聚合，状态真相在 PostgreSQL。
- `@ai-trpg/web`：页面与交互。
- `@ai-trpg/api-client`：契约层，生成的类型、`openapi-fetch` 客户端与错误适配。
- `@ai-trpg/shared`：跨端稳定事实，只放服务名、API 版本、默认端口。准入判据是「第一次请求之前两端必须一致」：需要出现在响应里的走契约——值随响应下发，客户端读生成类型而不是 import 引擎；只有不必下发、两端又都要算的（端口、版本、URL 拼装）才放这里。领域词表属于前者：属性名、道具大类这类文案以 `label` 字段下发，搬进共享包会让 `shared` 反过来依赖引擎，客户端的「只看得见投影」也就破了。

依赖方向：`web` 依赖 `api-client` 与 `shared`，`server` 依赖 `shared`，反向不允许。两者直接导出 TypeScript 源码，由 Vite、tsx、tsup 转译，骨架阶段不引入独立构建。

目标拓扑是「客户端 ⇄ 业务服务端 ⇄ PostgreSQL」。`agent:game` 与 HTTP 路由复用同一组编排；服务端不保留跨请求的权威世界对象。

→ 参见：[客户端页面与 mock 目录](web-client.md)

→ 参见：[开发规范](conventions.md)

## 分层与依赖方向

服务端内部是单向的：传输 → 编排 → 服务，基础设施被各层调用。

| 层 | 位置 | 决定什么 | 依赖 |
| --- | --- | --- | --- |
| 传输（HTTP） | `routes/` | 输入校验、身份、错误码与响应形状 | 编排层 |
| 传输（进程内 CLI） | `cli/agent-game/` | 参数、帮助、输出信封与退出码 | 编排层 |
| 传输（跨进程 CLI） | `cli/agent-api/` | 同上，执行体是一次 HTTP 调用 | HTTP 契约 |
| 编排 | `game-ops/` | 一次操作动哪些实体、什么顺序、注入哪组依赖，以及稳定的输出形状 | 服务层、`debug/` |
| 服务 | `game/` | 玩法、结算、回合与持久化原语 | 基础设施的类型与具名函数 |
| 基础设施 | `db/`、`debug/`、`llm/`、`deepseek/`、`rag/`、`imagegen/` | 连接、语料、模型与检索 | 不依赖上层 |

依赖只能向下。**玩法模块不写 SQL**：动作、道具效果、stage / world 回合、死亡与外观只调用 `game/persistence/` 的具名读写原语；解析动作的只读查询在 `game/lookup/`，事务边界在 `game/settle/`（`plan.ts` 计算端、`increment.ts` 推理端），行投影与事务执行器在 `game/persistence/rows.ts`，建局在 `game/create-game/`，整局状态的装配在 `game/game-state/`，事件流与游戏行的读写都在 `game/persistence/`。`test/persistence-boundary.test.ts` 用源码扫描守住这条边界。

`game/` 是业务层：不含 HTTP 适配（`fastify` 零引用，入口在 `routes/` 与 `plugins/`）、进程与调度（`cli/`、`jobs/`）、外部服务客户端（`llm/`、`deepseek/`、`rag/`、`imagegen`），只消费它们的类型、常量与默认实例；`db/` 与 `debug/` 同理，可以调具名函数，不持有连接、不自己开副作用。

`game/` 内部再分两层，判据是「谁驱动谁」而不是「属于哪个主题」：`game/kernel/` 放内容形状与文本渲染（`types`、`attributes`、`limits`、`addressing`、`observation-text`、`affixes`），零 I/O，除 `errors` 与 `memory/kinds` 外不 import 游戏模块；`game/agents/` 放吃世界宪法的那一组（三个回合、四个世界职能、三个旁路与 `bypass` 回路），只被外面驱动，反向调用只有结算、动作、台词准入与建局四组。分类判据与登记表见 [Agent 与工具](agents.md)。

编排为什么单独一层：`agent:game` 与 HTTP 是同一件事的两个入口。各自拼流程，「`npc` 该推进谁」「这个动作要哪几个推理依赖」就会长出两份答案——玩法测试盯得住结算，盯不住编排。所以编排只在 `game-ops`，传输层只做搬运。

`agent:api` 是刻意的例外：它在另一个进程里，只能经过 HTTP 契约，因此不依赖 `game-ops`。它与 `agent:game` 的能力对齐来自「同名命令 ↔ 同一端点 ↔ 同一份编排」，不是共享代码。

这条方向由 `test/dependency-boundary.test.ts` 的源码扫描守住，与路由和命令一起演进。

## 契约链

路由里的 Zod schema 是唯一契约源：导出 OpenAPI 3.1，再用 `openapi-typescript` 生成客户端类型，交给 `openapi-fetch` 消费。生成是离线的——构建 Fastify 实例后直接导出文档，不监听端口、不发网络请求，CI 与全新 clone 都不需要先起服务端。生成物不入库；`dev`、`typecheck`、`build` 都先确保它们存在。

只有声明了 response schema 的路由才进入契约。新增路由漏写 response 属于服务端缺陷，不在客户端补类型。

### 两个投影：`view` 与 `state`

一局有两份读模型，各有名字，不互相冒充：

| 投影 | 端点 | 谁读 | 是什么 |
| --- | --- | --- | --- |
| 观看者投影 `ActorView` | `GET /games/{game}`，建局也返回它 | 客户端 | 某个角色眼里的世界：按观察者渲染的名字、在场名单、锚点与出口 |
| 感知日志 `ActorLog` | `GET /games/{game}/log` | 预留（客户端暂不展示） | 该角色真正收到的几类观察与反馈，来自他自己的记忆 |
| 活状态 `state` | `GET /games/{game}/state` | 控制面：`agent:api`、排查 | 上帝视角的全量投影，含世界宪法、prompt 与真实签名 |

客户端读的投影是**已定型的契约**：形状源在 `game/client-view` 的 `ActorView`，`routes/schemas/client-view.ts` 用 `satisfies z.ZodType<ActorView>` 逐字段对照，引擎改字段会在编译期打断，而不是让客户端拿到一个它不认识的 JSON。具名 schema 因此进 `components.schemas`，客户端拿到的是 `ActorView` 这个名字，不是内联展开的一坨。

活状态仍是 `unknown`：它不服务任何页面，没人按字段消费，就不抄一份内部类型。两份投影的分工写在这里是为了让「客户端该读哪个」有唯一答案——观看者需要遮蔽，上帝视角不需要，把两者混成一个端点，遮蔽与全知就会在同一个响应里打架。

契约的形状服务于一条约束：**状态不缓存**。控制游戏流程一律基于最近一次 GET 的响应；写请求本身不携带状态，同一局的写入在锁住 game 行的位置排成一条。跑回合的写请求因此不回回合结果，只回一个作业 id：回合在请求之外执行，客户端读作业快照或重读观看者投影。`version` 是变更计数：客户端用它判断状态有没有变过，跑回合的入口会带着它做一次「视图过期」的比对——那是拒绝拿旧视图做决定，不是复用旧状态；条件请求只用于省带宽。公共事件流是另一回事：它只读、只追加，不参与判定，客户端可以临时缓存用于显示，按游标分段拉取即可。

→ 参见：[数据库](database.md)（读取分层）

→ 参见：[根 README](../README.md)

## 请求生命周期

页面经 `openapi-fetch` 客户端发请求；服务端用 Zod 校验输入并序列化输出；业务错误统一转成结构化响应。传输字段统一 camelCase，错误码是机器可读枚举、保持 snake_case。

→ 参见：[开发规范](conventions.md)

## 端口与环境

优先级：进程环境变量 > 仓库根 `.env` > `@ai-trpg/shared` 默认值。仓库只有一份 `.env`，server 与 web 共用，不建也能用默认值启动。

默认端口只写在 `shared`，`pnpm lint` 的端口守卫阻止其它位置硬编码；Vite 用 `strictPort`，端口冲突直接失败。只有带 `VITE_` 前缀的变量进入浏览器，密钥不得使用该前缀。

服务端默认监听 `0.0.0.0`；客户端未配置 `VITE_API_BASE_URL` 时按当前页面主机名推导服务端地址，所以用局域网 IP 打开页面就请求同一台机器，不在代码里钉死 localhost。开发期 `CORS_ORIGINS=*`，生产环境填具体来源。

→ 参见：[根 README](../README.md)

## 错误形状

所有非 2xx 响应统一为三个字段：稳定的机器可读 `error` 枚举、`message`、可选 `details`。客户端展示文案统一经过错误适配层，页面不自行拼接。

## 实体序号

身份用 UUID；排序另有一条每局递增的实体序号。world / stage / actor / signature / item 在创建时从本局计数器取号，所以同一局内任意两个实体都能比较，同一份内容重复开局会得到相同的序号。

序号只服务于确定性排序与复现：它不表达叙事顺序，也不是外键，解析实体仍然用 UUID；道具换归属时沿用原序号，不会因为被拾取而跳到列表末尾。已有局在迁移时按固定规则回填，计数器随后从最大号继续。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)

## 拉取循环

运行时只有一个驱动：拉取。agent 在回合开始时读自己的 memory 与当前状态，规划并提交动作；动作只改状态与事件流，不把结果推回任何人的上下文。下一次由调用方显式推动回合，agent 再拉一次。这也是“看见事件需要多推几步”的来源：事件先落到 stage，stage 更新 environment，actor 下一回合才读到。

四条约束，新增能力时都要满足：

- 状态只由拥有它的回合写：environment 与通道归 stage 回合，可交互锚点及其上的道具由内容层在建局时赋予、运行时不写，外观归外观阶段，结局归 world。
- 推理端只读控制面，不把未经观察者渲染的他人名字或他人私有信息写进 actor 记忆，也不直接产出面向 actor 的上下文；它只产出结构化见证：来源、目标与文本分开，名字与指代一律由引擎按观察者渲染。actor 自己行动的数值后果经既有伤害通道写回它自己的行动反馈；舞台可见的见证同时写公共流与舞台观察，只写给目标的见证只进目标观察；发起者不重复写 observation。actor 侧的知识一律由 actor pull，compact 只把同一主体的记忆改写成摘要。
- 引擎把事件追加到对应 owner 的 memory：不更新状态，也不唤醒 agent。跨 owner 写记忆只有 `memory/world-channel.ts` 一个入口（舞台报告、引擎事实、world 裁决），其他模块要告诉别的 owner 什么就走通道，不自建写入路径。
- actor / stage / world 都显式推动；唯一自动的是提交后的增量阶段（agent 词缀、死亡后的外观与掉落），只追加、不回滚、不触发另一个 agent。

主动推会同时引入时序、重复消费、跨作用域泄漏与上下文膨胀；拉取循环把这四件事收敛到回合边界。`test/state-writer-boundary.test.ts` 守住写入点的唯一性。

agent 的 pull 只读 environment、可交互锚点、观察与自己的 memory，不含 `game_messages`——那是 server→web 的事件通道，上帝视角、带名字，供客户端展示与后续寻址。

actor 获取的信息一律是 pull，这正是信息披露不变量成立的前提：将来若要让 actor 从推理端产生的信息缓存里“取信”，仍要做成 actor 自己的 pull 步骤，不得反推 actor 记忆。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、[信息披露](information-disclosure.md)

## LLM 层

LLM 是服务端内部依赖，不是客户端可调用的 API：浏览器只提交业务请求、展示业务结果，不接触模型名、prompt、tools 或 provider key。LLM 输出视为不可信中间数据，经业务校验后才能改变状态；provider 错误映射为业务错误，原始细节不透给客户端。

实现上分为 provider 无关的 `llm` 与 DeepSeek 实现 `deepseek`，依赖方向固定为 `deepseek → llm`。

结算分两端，顺序固定（`game/settle/plan.ts` 与 `increment.ts`）：计算端（公式、装备、静态词缀、数值）先结算并提交；推理/泛化端（agent 词缀、外观、掉落这类自然语言后果）只在提交之后追加。推理端是纯增量——失败只等于「这次没有增量」，不回滚计算端结果，也不阻断同回合的其它阶段；增量不做跨回合补账，但失败必须在过程轨迹里留下可解释的记录。

→ 参见：[Agent 与工具](agents.md)、[词缀](affixes.md)、[过程轨迹](debug-workflow.md)

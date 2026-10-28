# 开发规范

## 总则

- 单一事实源：契约来自生成流程，端口来自 `@ai-trpg/shared`，文档约定只写一处。
- 无聊但可靠：优先标准方案，不提前引入状态库、UI 库、SSR、WebSocket。
- 明确失败：端口冲突、契约缺失、环境变量非法都直接报错，不静默兜底。
- 能强制就不靠自觉：规则尽量由 Biome、`tsc`、守卫脚本或测试保证。

## 目录与依赖

服务端按职责分 `routes`、`plugins`、`db`、`game`、`llm`、`deepseek`；客户端按 `pages`、`features`、`api` 分层。`api` 不依赖 `features` 或 `pages`，`features` 之间不互相依赖；需要共享时下沉到 `api` 或更基础的 feature。

服务端路由不直接读 `process.env`，统一通过 `buildApp` 注入；密钥由 provider 客户端自己读取，不传给业务层。

→ 参见：[架构与契约](architecture.md)

## 命名

按角色区分文件名，每个角色只有一套规则：服务端与共享包用后端 / 库生态的 kebab-case；客户端用 React 生态的组件 PascalCase、hook 与工具函数 camelCase；测试跟随被测模块。共享包同时被两端引用，因此统一 kebab-case。

禁止同一角色出现两种写法，例如服务端同时存在 `error-handler.ts` 与 `errorHandler.ts`。分区与例外写在 `biome.json`，不在文档里复刻。

## API 字段

JSON 字段统一 camelCase，包括嵌套对象、路径参数与查询参数；全栈 TypeScript，不存在跨语言映射，也不引入全局转换中间件。错误码是稳定枚举值而非字段名，可保持 snake_case。

## 生成物与敏感文件

`openapi.json` 与 `schema.d.ts` 由 `pnpm gen:api` 生成，不入库、不手改；`.env` 不入库，仓库根 `.env.example` 是唯一示例；端口默认值只写在 `shared`，由 `pnpm check:ports` 守卫。

## 运行期目录

不使用点号前缀：过程轨迹放 `logs/trace`，世界快照放 `worlds`，故事总结放 `stories`，页面截图放 `screenshots`。都 gitignore 内容、只保留 `.gitkeep`，避免把 prompt、回复、状态、故事或截图误提交。

→ 参见：[LLM 基础组件](llm.md)

## 测试

服务端用 `app.inject()`，不监听真实端口；Web 用 Testing Library 与 jsdom，通过 stub `fetch` 模拟服务端。每个失败路径至少一个用例；新增纯函数优先补单测。接口变多后再引入 MSW。

契约生成不需要先启动服务端；路由改动后必须重新运行 `pnpm gen:api`，否则客户端类型仍是旧的。

## 注释与文档

代码是唯一事实源。注释只回答「为什么在这里」与「怎么用」，不复述行为、不记录讨论过程。设计取舍写进 `docs/`，并遵守知识库根节点的写作约束。

Markdown 由 `markdownlint-cli2` 检查，行宽规则 `MD013` 关闭，避免中文长句和表格被机械折行；`pnpm lint` 已包含 Markdown 检查。

→ 参见：[AI TRPG 知识库](README.md)

## 数据库

表与列 snake_case，API 与 TypeScript 内部字段 camelCase，只在数据库边界转换。迁移是唯一建表路径：schema 在服务端代码里，SQL 由 Drizzle Kit 生成并入库；开发期不做旧数据搬运，改形状后直接重置重刷。

→ 参见：[数据库](database.md)

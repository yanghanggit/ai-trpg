# 开发规范

## 总则

- 单一事实源：契约来自生成流程，端口来自 `@ai-trpg/shared`。
- 无聊但可靠：优先标准方案，不提前引入状态库、UI 库、SSR、WebSocket。
- 明确失败：端口冲突、契约缺失、环境变量非法都直接报错，不静默兜底。
- 能强制就不靠自觉：规则交给 Biome、`tsc`、守卫脚本或测试，不在文档里复刻。

## 目录与依赖

服务端分 `routes`、`plugins`、`db`、`game`、`llm`、`deepseek`，客户端分 `pages`、`features`、`api`。依赖单向：`api` 不依赖 `features` 与 `pages`，`features` 之间不互相依赖，需要共享时下沉。路由不直接读 `process.env`，由 `buildApp` 注入；密钥只由 provider 客户端读取，不传业务层。

→ 参见：[架构与契约](architecture.md)

## 命名

服务端与共享包用 kebab-case，客户端组件 PascalCase、hook 与工具函数 camelCase，测试跟随被测模块的大小写，位置见下文「测试」。同一角色只允许一种写法，例如服务端不得同时存在 `error-handler.ts` 与 `errorHandler.ts`；分区与例外归 `biome.json`。

## API 字段

JSON 字段统一 camelCase，含嵌套对象、路径参数与查询参数；全栈 TypeScript，不做跨语言映射与全局转换。错误码是稳定枚举，保持 snake_case。

## 生成物与敏感文件

生成物由 `pnpm gen:api` 产出，不手改；`.env` 不入库，示例只有仓库根 `.env.example`。

## 运行期目录

仓库根只放三类东西：工作区（`apps` / `packages` / `scripts` / `docs`）、工作区配置与说明文件、运行期产物根。

- `logs/`：所有过程留痕与调试渲染，按产物类型分一级子目录（轨迹、记忆、prompt、快照、故事、截图、手工 e2e）。全部 gitignore，只保留 `logs/.gitkeep`。
- `images/`：可被业务消费的生成资产库；它是运行时数据，不是调试输出。

新增运行期输出先放进 `logs/` 的现有子目录；只有像 `images/` 一样会被业务消费的资产才单列根目录。不新增其他根级运行期目录，也不把运行期产物混进 `apps` / `packages`。

→ 参见：[LLM 基础组件](llm.md)

## 测试

服务端用 `app.inject()`，不监听真实端口。每个失败路径至少一个用例，新增纯函数优先补单测。

服务端用例集中在 `apps/server/test/`，不与 `src/` 同级：它们多是跨模块集成与架构边界守卫，没有唯一的被测文件。共享 fixture 用同目录的具名 helper，不带 `.test` 后缀，避免被当作用例收集。平铺到翻找成本明显上升时按 `src/` 子目录分组，不改回同级。

## 注释与文档

代码是唯一事实源；注释只回答「为什么在这里」「怎么用」，不复述行为、不记录讨论过程。设计取舍写进 `docs/`，遵守知识库的写作约束。

Markdown 检查只覆盖手写文档：`logs/` 下的导出保留模型看到的字面格式（例如 `[种族]:`），不按 Markdown 语法校验。

→ 参见：[引擎知识库](README.md)

## 数据库

表与列 snake_case，API 与 TypeScript 内部字段 camelCase，只在数据库边界转换。迁移是唯一建表路径：schema 在服务端代码里，SQL 由 Drizzle Kit 生成并入库，不手改。开发期不做旧数据搬运，改形状后直接重置重刷，只保留一份 baseline。

→ 参见：[数据库](database.md)

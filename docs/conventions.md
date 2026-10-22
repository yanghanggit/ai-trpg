# 开发规范

## 总则

- 单一事实源：契约来自生成流程，端口来自 `@ai-trpg/shared`，文档约定只写一处。
- 无聊但可靠：优先标准方案，不提前引入状态库、UI 库、SSR、WebSocket。
- 明确失败：端口冲突、契约缺失、环境变量非法都直接报错，不静默兜底。
- 能强制就不靠自觉：规则尽量由 Biome、`tsc`、守卫脚本或测试保证。

## 目录与依赖

服务端按职责分 `routes`、`plugins`、`llm`、`deepseek`；客户端按 `pages`、`features`、`api` 分层。`api` 不依赖 `features` 或 `pages`，`features` 之间不互相依赖；需要共享时下沉到 `api` 或更基础的 feature。

服务端路由不直接读 `process.env`，统一通过 `buildApp` 注入环境配置。LLM 层需要密钥时由 provider 客户端读取，不把密钥传给业务层。

→ 参见：[架构与契约](architecture.md)

## 命名

按角色区分文件名，每个角色只有一套规则，由 Biome 分区强制：

| 位置 / 角色                   | 规则                            | 例                                                       |
| ----------------------------- | ------------------------------- | -------------------------------------------------------- |
| `apps/server/**/*.ts`         | kebab-case                      | `error-handler.ts`、`generate-openapi.ts`                |
| `packages/**/*.ts`            | kebab-case                      | `api-client/src/client.ts`、`scripts/generate-schema.ts` |
| `scripts/**/*.mjs`            | kebab-case                      | `check-ports.mjs`                                        |
| `apps/web` 组件 / 页面 `.tsx` | PascalCase，默认导出同名组件    | `ServerConnectionCard.tsx`                               |
| `apps/web` Hook `.ts`         | camelCase，`use` 开头，同名导出 | `useServerHealth.ts`                                     |
| `apps/web` 普通 `.ts`         | camelCase，文件名 = 导出名      | `formatUptime.ts`                                        |
| 测试                          | 跟随被测模块 + `.test`          | `error-handler.test.ts` / `formatUptime.test.ts`         |
| 例外                          | 不检查                          | `index.ts`、`*.config.ts`、`*.d.ts`                      |

服务端与共享包采用后端 / 库生态常见的 kebab-case；客户端采用 React 生态的组件 PascalCase、hook 与工具函数 camelCase。共享包同时被两端引用，因此统一 kebab-case。

禁止同一角色出现两种写法，例如服务端同时存在 `error-handler.ts` 与 `errorHandler.ts`。

## API 字段

JSON 字段统一 camelCase，包括嵌套对象、路径参数与查询参数。全栈均为 TypeScript，不存在跨语言映射，不引入全局 camel / snake 转换中间件。

错误码是稳定枚举值，不属于字段名，可保持 snake_case。

## 生成物与敏感文件

`openapi.json` 与 `schema.d.ts` 由 `pnpm gen:api` 生成，不入库、不手改。`.env` 不入库，仓库根 `.env.example` 是唯一示例。端口默认值只写在 `@ai-trpg/shared`，由 `pnpm check:ports` 守卫。

## 运行期目录

不使用点号前缀：LLM 对话留痕放 `logs/llm`，页面截图放 `screenshots`。两者都 gitignore 内容、只保留 `.gitkeep`，避免把 prompt、回复或截图误提交。

→ 参见：[LLM 基础组件](llm.md)

## 测试

服务端用 `app.inject()`，不监听真实端口；Web 用 Testing Library 与 jsdom，通过 stub `fetch` 模拟服务端。每个失败路径至少一个用例；新增纯函数优先补单测。接口变多后再引入 MSW。

## 注释与文档

代码是唯一事实源。注释只回答「为什么在这里」与「怎么用」，不复述代码行为，不记录讨论过程；代码已经说清楚的，不再用注释重复。设计取舍写进 `docs/`，并遵守知识库根节点的写作约束。

→ 参见：[AI TRPG 知识库](README.md)

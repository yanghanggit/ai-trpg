# 开发规范

> 工程约定的总入口。架构与契约见 [architecture.md](architecture.md)。

## 一、总则

1. **单一事实源**：契约来自 `pnpm gen:api`；端口来自 `@ai-trpg/shared`；约定只写在本文件，别处引用不复制。
2. **无聊但可靠**：优先标准方案，不提前引入状态库、UI 库、SSR、WebSocket。
3. **明确失败**：端口冲突、契约缺失、环境变量非法都直接报错，不做静默兜底。
4. **能强制就不靠自觉**：每条规则尽量由 Biome、`tsc`、守卫脚本或测试保证。

## 二、目录与依赖方向

```text
apps/web/src/
  pages/          路由级屏幕（*Page / *Route）
  features/<域>/  领域组件、hook、纯函数
  api/            传输层与错误适配，无业务功能
  test/           测试基建
apps/server/src/
  routes/         路由与 Zod schema
  plugins/        CORS、错误处理等横切能力
  app.ts          buildApp()：装配可测试实例
  index.ts        读取环境变量、监听、优雅停机
  env.ts          环境变量 schema
```

允许的依赖方向：

```text
pages ──▶ features ──▶ api
任意层 ──▶ @ai-trpg/shared / @ai-trpg/api-client
```

- `api/` 不依赖 `features/` 或 `pages/`。
- `features/` 之间不互相依赖；需要共享时下沉到 `api/` 或新建更基础的 feature。
- 服务端路由不直接读 `process.env`，统一用 `buildApp({ env })` 注入。

## 三、文件命名

按「目录 + 文件角色」分别约定，但每个角色只有一套规则，由 Biome 分区强制：

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

### 为什么这样分

服务端与共享包采用后端/库生态常见的 kebab-case（Angular、NestJS、npm 包名都是这个习惯）；客户端采用 React 生态的标准：组件 PascalCase，hook 与工具函数 camelCase。React 本身也是按角色区分命名的，所以这不是「两套标准」，而是**一张按角色划分的判定表**。

共享包（`packages/shared`、`packages/api-client`）统一用 kebab-case，因为同时被 server 与 web 引用，不能按消费者分裂。

统一的对象是规则，不是字符本身。禁止的是「同一角色两种写法」，例如 server 里同时出现 `error-handler.ts` 与 `errorHandler.ts`。

两个独立问题不要混淆：
- **文件名**：kebab / camel / Pascal，按上表。
- **API 字段**：统一 camelCase（JSON 字段名）；错误码是枚举值，不属于字段命名规则。

macOS / Windows 默认大小写不敏感，kebab-case 天然规避「只差大小写」的冲突；Web 侧保留 PascalCase 是 React 的硬习惯，通过「一概念一文件 + Biome」避免重名。

## 四、API 使用

1. 类型只来自生成的 `packages/api-client/src/schema.d.ts`，**禁止手写请求 / 响应类型**。
2. 禁止页面里直接 `fetch`；通过 `api`（`apps/web/src/api/client.ts` 导出的 openapi-fetch 客户端）发请求。
3. 跨接口编排抽成 `features/<域>/use*.ts`，不写在 JSX 里。
4. 错误必须显式处理：`unwrap()` 抛 `ApiError`，页面展示 `describeApiError()` 的结果。
5. JSON 字段统一 camelCase；不混用 snake_case，也不引入全局 camel/snake 转换中间件。
   - 包括嵌套对象字段、路径参数、查询参数：`/api/v1/games/{gameId}`、`?pageSize=20`。
   - `error` 的取值是稳定枚举（如 `invalid_request`），不是字段名，可以保持 snake_case。
   - 全栈均为 TS，JSON 字段直接对应 JS 对象属性，不存在跨语言映射。
6. 认证等横切头只在客户端 middleware 注入，业务代码不碰。

## 五、生成物与守卫

| 内容                                  | 规则                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `packages/api-client/openapi.json`    | 由 `pnpm gen:openapi` 生成，不入库、不手改                     |
| `packages/api-client/src/schema.d.ts` | 由 `pnpm gen:api` 生成，不入库、不手改                         |
| 端口默认值                            | 只写在 `packages/shared/src/index.ts`，`pnpm check:ports` 校验 |
| `.env`                                | 不入库；根目录 `.env.example` 是唯一示例                       |

## 六、测试

- 服务端用 `app.inject()`，不监听真实端口。
- Web 用 Testing Library + jsdom；当前通过 stub `globalThis.fetch` 模拟服务端，接口变多后再引入 MSW。
- 每个失败路径至少有一个用例（如服务端不可达）。
- 新增纯函数优先补单测，例如 `formatUptime`。

## 七、注释

注释只回答「为什么在这里」与「怎么用」，不复述下面代码做了什么，不记录讨论过程。设计取舍写进 `docs/`。

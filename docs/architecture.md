# 架构与契约

## 一、四个包的角色

| 包                    | 角色                                                            | 不做什么                        |
| --------------------- | --------------------------------------------------------------- | ------------------------------- |
| `@ai-trpg/server`     | 服务端真相：路由、校验、业务状态                                | 不引用客户端代码                |
| `@ai-trpg/web`        | 玩家入口：页面、交互、服务端状态缓存                            | 不手写 API 类型、不直接 `fetch` |
| `@ai-trpg/api-client` | 契约层：生成的类型 + `openapi-fetch` 客户端 + `unwrap` 错误适配 | 不含业务逻辑                    |
| `@ai-trpg/shared`     | 跨端常量：服务名、API 版本、默认端口                            | 不含运行时状态、不依赖其它包    |

依赖方向是单向的：

```text
web ──▶ api-client ──▶ (生成的 schema)
 │
 └────▶ shared ◀──── server
```

`api-client` 与 `shared` 直接导出 TypeScript 源码，由 Vite / tsx / tsup 负责转译；骨架阶段不为它们引入独立构建步骤。

## 二、契约生成链路

```text
路由 schema（Zod）
  → Fastify + @fastify/swagger（OpenAPI 3.1）
  → packages/api-client/openapi.json
  → openapi-typescript
  → packages/api-client/src/schema.d.ts
  → openapi-fetch 的类型化 client
```

关键决策：**离线生成**。`apps/server/scripts/generate-openapi.ts` 直接 `buildApp()` 再调用 `app.swagger()`，不监听端口、不发网络请求。因此 CI 与全新 clone 都能生成契约，不需要先起服务端。

生成物（`openapi.json`、`schema.d.ts`）不入库，避免「代码变了但生成物没更新」的假一致。`pnpm dev`、`pnpm typecheck`、`pnpm build` 会先运行 `pnpm gen:api`。

契约只对**已声明 response schema** 的路由生效。新增路由时漏写 `schema.response`，客户端拿到的就是松散类型；这属于服务端缺陷，不在客户端补类型。

## 三、一次请求的生命周期

1. 页面调用 `features/<domain>/use*.ts` 中的 hook。
2. Hook 通过 `openapi-fetch` 的 `api.GET/POST` 发请求，路径与响应类型来自生成的 `paths`。
3. 服务端 Fastify 用 Zod schema 校验输入，`fastify-type-provider-zod` 负责校验与序列化。
4. 业务错误经统一 error handler 变成 `{ error, message, details? }`；`unwrap()` 在客户端把非 2xx 转成 `ApiError`。
5. TanStack Query 缓存服务端状态；轮询、失效与重试由它负责。

传输字段统一 **camelCase**：server 与 web 都是 TS，字段可以直接作为 JS 标识符使用，生成类型与业务代码无需转换。错误码是枚举值（如 `invalid_request`），不受字段命名规则约束。

## 四、端口与环境变量

优先级：**进程环境变量 > 仓库根 `.env` > `packages/shared` 默认值**。
- 服务端读取 `HOST` / `PORT` / `CORS_ORIGINS` / `LOG_LEVEL`，以及预留的 `DEEPSEEK_API_KEY` / `REPLICATE_API_TOKEN`。
- Web 读取 `VITE_API_BASE_URL` / `VITE_DEV_PORT`；只有 `VITE_` 前缀会进入浏览器，密钥绝不能加这个前缀。
- 默认端口只写在 `packages/shared/src/index.ts`，`pnpm lint` 会用 `scripts/check-ports.mjs` 阻止别处硬编码。
- Vite 使用 `strictPort`：端口被占用直接失败，不静默顺延。

### 局域网优先

- 服务端默认 `HOST=0.0.0.0`，局域网内其他设备可直接访问。
- 客户端未配置 `VITE_API_BASE_URL` 时，取 `window.location.hostname` + 服务端端口；因此用 en0 IP 打开页面就请求该 IP，不在代码里钉死 localhost。
- 开发期 `CORS_ORIGINS=*`，换网卡 IP 不需要改配置；服务端在 `NODE_ENV=production` 且仍为 `*` 时打印警告，生产环境应填具体来源。
- 手动固定地址时，在根 `.env` 写 `VITE_API_BASE_URL=http://<en0 IP>:8787`；IP 变化后同步修改。

修改端口时，若手动配置了 `VITE_API_BASE_URL`，需要与 `PORT` 一起改；`CORS_ORIGINS=*` 时无需跟着改。

## 五、错误形状

服务端所有非 2xx 响应统一为：

```json
{ "error": "invalid_request", "message": "请求参数校验失败", "details": [] }
```

字段名是 camelCase；`error` 的值是稳定的机器可读枚举，保持 snake_case。
- 校验失败：400 `invalid_request`
- 未知路由：404 `not_found`
- 未预期异常：500 `internal_server_error`
- 响应不符合 schema：500 `invalid_response`

客户端展示文案统一经过 `apps/web/src/api/describeApiError.ts`，页面不自己拼错误信息。

## 六、新增一个接口的顺序

1. 在 `apps/server/src/routes/` 增加路由，声明 `schema`（含 `response`）。
2. 在 `apps/server/test/` 加 `app.inject()` 测试。
3. 运行 `pnpm gen:api`。
4. 在 `apps/web/src/features/<domain>/` 写 hook；需要跨接口编排时放这里，不写进 JSX。
5. 页面消费 hook，处理 pending / error / success 三态。
6. 跑 `pnpm typecheck && pnpm lint && pnpm test`。

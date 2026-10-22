# 架构与契约

## 包职责

- `@ai-trpg/server`：服务端入口，负责路由、校验、事务与业务规则；游戏状态真相在 PostgreSQL。
- `@ai-trpg/web`：玩家入口，负责页面、交互与服务端状态缓存。
- `@ai-trpg/api-client`：契约层，包含生成的类型、`openapi-fetch` 客户端与错误适配。
- `@ai-trpg/shared`：跨端常量，只放服务名、API 版本、默认端口等稳定事实。

依赖方向：`web` 依赖 `api-client` 与 `shared`，`server` 依赖 `shared`；`api-client` 与 `shared` 不反向依赖应用。两者直接导出 TypeScript 源码，由 Vite、tsx、tsup 转译，骨架阶段不引入独立构建。

服务端与 PostgreSQL 的拓扑固定为「客户端 ⇄ 业务服务端 ⇄ PostgreSQL」。服务端不保留跨请求的权威世界对象；数据库是状态源，连接池、迁移与开发数据流程见数据库文档。

→ 参见：[开发规范](conventions.md)

## 契约链

路由中的 Zod schema 是唯一契约源，经 OpenAPI 3.1 导出，再由 `openapi-typescript` 生成客户端类型，最终交给 `openapi-fetch` 消费。

契约生成是离线的：构建 Fastify 实例后直接导出文档，不监听端口、不发网络请求，因此 CI 与全新 clone 不需要先启动服务端。生成物不入库，避免「代码已变、生成物未更新」的假一致；`dev`、`typecheck`、`build` 都会先确保它们存在。

只有声明了 response schema 的路由才进入契约。新增路由漏写 response 属于服务端缺陷，不在客户端补类型。

→ 参见：[本地开发](dev-setup.md)

## 请求生命周期

页面通过 feature hook 调用 `openapi-fetch` 客户端；服务端用 Zod 校验输入并序列化输出；业务错误统一经 error handler 转成结构化响应；TanStack Query 负责客户端缓存、轮询与失效。

传输字段统一 camelCase。错误码是机器可读枚举，保持 snake_case，不受字段命名规则影响。

→ 参见：[开发规范](conventions.md)

## 端口与环境

优先级：进程环境变量 > 仓库根 `.env` > `@ai-trpg/shared` 默认值。仓库只有一份 `.env`，server 与 web 共用；不建 `.env` 也能用默认值启动。

默认端口只写在 `@ai-trpg/shared`，`pnpm lint` 的端口守卫阻止其它位置硬编码。Vite 使用 `strictPort`，端口冲突直接失败，不静默顺延。只有带 `VITE_` 前缀的变量会进入浏览器，密钥不得使用该前缀。

→ 参见：[本地开发](dev-setup.md)

## 局域网优先

服务端默认监听 `0.0.0.0`；客户端未配置 `VITE_API_BASE_URL` 时，按当前页面主机名推导服务端地址，因此用局域网 IP 打开页面就请求同一台机器，不在代码里钉死 localhost。

开发期 `CORS_ORIGINS=*`，换网卡 IP 不需要改配置；生产环境应填具体来源。手动固定地址时，`VITE_API_BASE_URL` 必须与端口配置同步。

## 错误形状

所有非 2xx 响应统一为 `error`、`message`、可选 `details` 三个字段。`error` 是稳定的机器可读枚举：校验失败、未知路由、未预期异常、响应不符合契约分别对应明确值。客户端展示文案统一经过错误适配层，页面不自行拼接。

## LLM 层

LLM 是服务端内部依赖，不是客户端可调用的 API。拓扑为「业务服务端 ⇄ LLM 服务商」：浏览器只提交业务请求、展示业务结果，不接触模型名、prompt、tools 或 provider key。

游戏状态、上下文组装、工具执行、输出校验与持久化全部在服务端完成。LLM 输出视为不可信中间数据，经业务校验后才能改变状态；provider 错误映射为业务错误，不把原始细节透给客户端。API key 只存在于服务端环境，不得进入任何 `VITE_` 变量或客户端日志。

实现上分为 provider 无关的 `llm` 与 DeepSeek 实现 `deepseek`，依赖方向固定为 `deepseek → llm`。业务侧通常只取已绑定默认实例的 `agentLoop` / `batchComplete`；`llm` 不得反向 import 具体 provider。

→ 参见：[LLM 基础组件](llm.md) → 参见：[数据库](database.md)

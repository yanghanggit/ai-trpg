# 架构与契约

## 包职责

- `@ai-trpg/server`：路由、校验、事务与业务规则；`game` 服务层承载 game 聚合，状态真相在 PostgreSQL。
- `@ai-trpg/web`：页面、交互与服务端状态缓存。
- `@ai-trpg/api-client`：契约层，生成的类型、`openapi-fetch` 客户端与错误适配。
- `@ai-trpg/shared`：跨端稳定事实，只放服务名、API 版本、默认端口。

依赖方向：`web` 依赖 `api-client` 与 `shared`，`server` 依赖 `shared`，反向不允许。两者直接导出 TypeScript 源码，由 Vite、tsx、tsup 转译，骨架阶段不引入独立构建。

目标拓扑是「客户端 ⇄ 业务服务端 ⇄ PostgreSQL」。`agent:game` 与 HTTP 路由复用同一 `game` 服务层；服务端不保留跨请求的权威世界对象。

服务端内部再分一层：**玩法模块不写 SQL**。动作、物品效果、stage / world 回合、死亡与外观只调用 `game/persistence/` 的具名读写原语；解析动作的只读查询在 `game/apply/queries.ts`，事务边界在 `game/apply/index.ts`，建局与整局读取在 `game/service.ts`。`test/persistence-boundary.test.ts` 用源码扫描守住这条边界。

→ 参见：[开发规范](conventions.md)

## 契约链

路由里的 Zod schema 是唯一契约源：导出 OpenAPI 3.1，再用 `openapi-typescript` 生成客户端类型，交给 `openapi-fetch` 消费。生成是离线的——构建 Fastify 实例后直接导出文档，不监听端口、不发网络请求，CI 与全新 clone 都不需要先起服务端。生成物不入库；`dev`、`typecheck`、`build` 都先确保它们存在。

只有声明了 response schema 的路由才进入契约。新增路由漏写 response 属于服务端缺陷，不在客户端补类型。

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

## LLM 层

LLM 是服务端内部依赖，不是客户端可调用的 API：浏览器只提交业务请求、展示业务结果，不接触模型名、prompt、tools 或 provider key。LLM 输出视为不可信中间数据，经业务校验后才能改变状态；provider 错误映射为业务错误，原始细节不透给客户端。

实现上分为 provider 无关的 `llm` 与 DeepSeek 实现 `deepseek`，依赖方向固定为 `deepseek → llm`。

结算分两端，顺序固定：计算端（公式、装备、数值）先结算并提交；推理/泛化端（词缀、外观、掉落这类自然语言效果）只在提交之后追加。推理端是纯增量——失败只等于「这次没有增量」，不回滚计算端结果，也不阻断同回合的其它阶段；增量不做跨回合补账，但失败必须在过程轨迹里留下可解释的记录。

→ 参见：[LLM 基础组件](llm.md)、[过程轨迹](debug-workflow.md)

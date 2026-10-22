# AI TRPG

AI 跑团项目的新起点：TypeScript monorepo，服务端与客户端共享同一份 API 契约。

当前是**骨架 + 空页**阶段：客户端只有一个页面，调用 `GET /api/v1/health`，展示服务端是否可达、版本、运行时长与请求延迟。

## 技术栈

| 层        | 选择                                                   | 说明                               |
| --------- | ------------------------------------------------------ | ---------------------------------- |
| 运行时    | Node.js >= 22 / ESM                                    | 服务端与工具链统一                 |
| 包管理    | pnpm workspaces                                        | 不引入 Turbo / Nx                  |
| 服务端    | Fastify 5 + Zod 4                                      | 插件、校验、日志、OpenAPI 一步到位 |
| 客户端    | Vite + React 19 + React Router + TanStack Query        | SPA，无 SSR                        |
| HTTP 契约 | Zod → OpenAPI → `openapi-typescript` → `openapi-fetch` | 类型端到端，不手写请求/响应类型    |
| 质量      | Biome + Vitest + `tsc --noEmit`                        | lint / format 一个工具             |

## 目录结构

```text
apps/
  server/         Fastify 服务端（服务端真相）
  web/            Vite + React 客户端
packages/
  shared/         跨端常量：服务名、API 版本、默认端口
  api-client/     生成的契约类型 + openapi-fetch 客户端
docs/             架构、规范与本地开发文档
scripts/          仓库级脚本（端口守卫、截图）
screenshots/      截图输出（已 gitignore，仅本地保留）
.pi/extensions/   pi 扩展：DeepSeek 搜索 / 网页抓取 / 识图
```

## 快速开始

### 一条龙（复制粘贴）

```bash
pnpm pipeline
```

它等价于下面这条完整管线（`pipeline` 跑完检查后直接进入 `pnpm dev`）：

```bash
pnpm install && pnpm gen:api && pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && pnpm dev
```

只想跑检查、不启动服务：

```bash
pnpm verify
```

### 分步启动

```bash
# Node 22+，pnpm 12（corepack enable 后使用 packageManager 字段）
pnpm install
pnpm dev            # 默认 HOST=0.0.0.0，客户端跟随页面主机名
```

启动后终端会打印 Vite 的 Network 地址，用 `en0` 那条访问（不要用 localhost）：

```text
➜  Local:   http://localhost:5373/
➜  Network: http://192.168.x.x:5373/  en0
```

- 客户端：终端里的 `Network` 地址
- 服务端健康检查：`http://<en0 IP>:8787/api/v1/health`
- OpenAPI 文档：`http://<en0 IP>:8787/openapi.json`

```bash
curl http://192.168.x.x:8787/api/v1/health
```

需要填 LLM 密钥或固定服务端地址时，再 `cp .env.example .env`；不建 `.env` 也能用默认值启动。

## 常用命令

| 命令              | 说明                                                         |
| ----------------- | ------------------------------------------------------------ |
| `pnpm pipeline`   | 一条龙：install → 生成契约 → 检查 → 测试 → 构建 → `pnpm dev` |
| `pnpm verify`     | 只跑检查链，不启动服务                                       |
| `pnpm dev`        | 生成契约后并行启动服务端与客户端                             |
| `pnpm dev:server` | 只启动服务端（`tsx watch`）                                  |
| `pnpm dev:web`    | 只启动客户端                                                 |
| `pnpm gen:api`    | 离线生成 `openapi.json` 与客户端类型（不需要先启动服务端）   |
| `pnpm typecheck`  | 全仓 TypeScript 检查                                         |
| `pnpm lint`       | Biome 检查 + 端口唯一来源守卫                                |
| `pnpm format`     | Biome 格式化                                                 |
| `pnpm test`       | 服务端 inject 测试 + Web 组件测试                            |
| `pnpm test:run`   | 同上，显式单次运行（CI / 管线使用）                          |
| `pnpm build`      | 生成契约 + 服务端打包 + Web 生产构建                         |
| `pnpm screenshot` | 用 headless Chrome 给页面截图（输出到 `screenshots/`）       |

## API 契约

```text
路由里的 Zod schema
  → @fastify/swagger 导出 openapi.json
  → openapi-typescript 生成 schema.d.ts
  → openapi-fetch 提供带类型的 client
```

生成物不入库；`pnpm dev` / `typecheck` / `build` 都会先确保它们存在。细节见 [docs/architecture.md](docs/architecture.md)。

## 文档

- [docs/README.md](docs/README.md)：文档索引
- [docs/architecture.md](docs/architecture.md)：分层、契约链路、端口与环境变量
- [docs/conventions.md](docs/conventions.md)：目录、命名、API 使用规范
- [docs/dev-setup.md](docs/dev-setup.md)：本地开发、联调与排错

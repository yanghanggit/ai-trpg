# AI TRPG

AI 跑团项目：TypeScript monorepo，Fastify 服务端 + React 客户端，共享 OpenAPI 契约。

技术栈：Node.js 22 / TypeScript / pnpm workspaces / Fastify / React + Vite。

## 环境要求

- Node.js >= 22
- pnpm 12（`corepack enable`，版本由 `packageManager` 固定）
- 本机 PostgreSQL 14+

## 本地启动

```bash
pnpm install
cp .env.example .env   # 可选：需要 LLM key、数据库或固定服务端地址时
createdb ai_trpg_dev   # 已存在则跳过
createdb ai_trpg_test
pnpm db:migrate
pnpm db:demo
pnpm dev
```

`pnpm dev` 会先离线生成 API 契约，再并行启动服务端与客户端。数据库连接串在根 `.env` 的 `DATABASE_URL`；第一条 game 切片已接入，可用 `agent:game` 创建并推进，详见开发文档。

启动后访问终端打印的地址：

- Web：`http://<局域网 IP>:5373/`（Vite 的 Network 地址）
- API：`http://<局域网 IP>:8787/api/v1/health`

服务端默认监听 `0.0.0.0`，局域网内其它设备可直接访问。不要用 `localhost` 访问另一台机器；IP 变化后以 Vite 输出的 Network 地址为准。修改 `.env` 后需要重启 dev。

## 常用命令

| 命令                  | 说明                                                          |
| --------------------- | ------------------------------------------------------------- |
| `pnpm dev`            | 生成契约后并行启动服务端与客户端                              |
| `pnpm dev:server`     | 只启动服务端                                                  |
| `pnpm dev:web`        | 只启动客户端                                                  |
| `pnpm verify`         | install → 契约 → typecheck → lint → 测试 → 构建（不启动服务） |
| `pnpm pipeline`       | `verify` 通过后直接进入 `pnpm dev`                            |
| `pnpm test:run`       | 单次运行全部测试                                              |
| `pnpm lint`           | Biome + 端口守卫 + Markdown 检查                              |
| `pnpm format`         | Biome + Markdown 格式化                                       |
| `pnpm gen:api`        | 重新生成 OpenAPI 与客户端类型                                 |
| `pnpm lint:md`        | 单独检查 Markdown                                             |
| `pnpm lint:md:fix`    | 修复可自动修复的 Markdown 问题                                |
| `pnpm db:generate`    | 根据 schema 生成 SQL 迁移                                     |
| `pnpm db:migrate`     | 应用数据库迁移                                                |
| `pnpm db:check`       | 检查数据库连接与基础设施表                                    |
| `pnpm db:seed`        | 写入 demo 用户与基础元数据                                    |
| `pnpm db:reset --yes` | 清空登记过的开发表                                            |
| `pnpm db:demo`        | 迁移 + 重置 + 黑暗奇幻 demo seed                              |
| `pnpm build`          | 生产构建（服务端 + Web）                                      |
| `pnpm smoke:deepseek` | 真实调用 DeepSeek 的冒烟测试（需要 key，可能产生费用）        |
| `pnpm agent:game`     | 数据库 / 快照驱动的开发期 agent CLI                           |
| `pnpm agent:api`      | 对运行中的服务端做 HTTP API 走查                              |

## 部署

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @ai-trpg/server start
```

- 服务端产物：`apps/server/dist/index.js`
- Web 产物：`apps/web/dist/`，用 nginx / Caddy 等静态托管
- 生产配置优先使用进程环境变量；常用项：
  - `HOST=0.0.0.0`
  - `PORT=8787`
  - `CORS_ORIGINS=https://your-domain`
  - `DEEPSEEK_API_KEY=...`（使用 LLM 功能时）
- `VITE_API_BASE_URL` 在构建时写入前端。API 与页面不同源时，构建前设置：

  ```bash
  VITE_API_BASE_URL=https://api.example.com pnpm build
  ```

  同源反向代理时，设置为页面域名，并把 `/api/` 转发到 `127.0.0.1:8787`。

- 健康检查：`curl http://127.0.0.1:8787/api/v1/health`

## 文档

完整文档见 [docs/README.md](docs/README.md)。

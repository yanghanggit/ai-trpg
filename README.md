# AI TRPG

AI 跑团项目：TypeScript monorepo，Fastify 服务端 + React 客户端，共享 OpenAPI 契约。

技术栈：Node.js 22 / TypeScript / pnpm workspaces / Fastify / React + Vite。

## 环境要求

- Node.js >= 22
- pnpm 12（`corepack enable`，版本由 `packageManager` 固定）
- 本机 PostgreSQL 14+，并安装与版本匹配的 pgvector 扩展

数据库账号需要有扩展权限：迁移会自动执行 `CREATE EXTENSION IF NOT EXISTS vector`。

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

`pnpm dev` 会先离线生成 API 契约，再并行启动服务端与客户端。数据库连接串在根 `.env` 的 `DATABASE_URL`；测试库由数据库测试在运行时自行迁移。

启动后访问终端打印的地址：

- Web：`http://<局域网 IP>:5373/`（Vite 的 Network 地址）
- API：`http://<局域网 IP>:8787/api/v1/health`

## 局域网访问

服务端默认监听 `0.0.0.0`；客户端未配置 `VITE_API_BASE_URL` 时按当前页面主机名推导地址，所以用局域网 IP 打开页面就请求同一台机器——不要用 `localhost` 访问另一台机器。IP 变化后以 Vite 输出的 Network（en0）地址为准。需要固定地址时在根 `.env` 设 `VITE_API_BASE_URL=http://<en0 IP>:8787` 并重启；建议路由器做 MAC 绑定。

## 环境变量

仓库根只有一份 `.env`，server 与 web 共用；变量清单、默认值与注释以 `.env.example` 为准。优先级：进程环境变量 > `.env` > `@ai-trpg/shared` 默认值，不建 `.env` 也能用默认值启动。修改 `.env` 后必须重启 dev，Vite 只在启动时读取环境变量。

只有带 `VITE_` 前缀的变量会进入浏览器，密钥不得使用该前缀。

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
| `pnpm db:generate`    | 根据 schema 生成 SQL 迁移                                     |
| `pnpm db:migrate`     | 应用数据库迁移                                                |
| `pnpm db:check`       | 检查数据库连接与基础设施表                                    |
| `pnpm db:reset --yes` | 清空登记过的开发表                                            |
| `pnpm db:demo`        | 迁移 + 重置 + 黑暗奇幻 demo 数据                              |
| `pnpm build`          | 生产构建（服务端 + Web）                                      |
| `pnpm screenshot`     | 截图前端页面（需先启动 dev，依赖本机 Chrome）                 |
| `pnpm clean:dev`      | 清理开发期临时目录，默认只预览，加 `--yes` 才删               |
| `pnpm smoke:deepseek` | 真实调用 DeepSeek 的冒烟测试（需要 key，可能产生费用）        |
| `pnpm image`          | 图像生成基建 CLI；生成、编辑、批量与资产列表                  |
| `pnpm job`            | 后台作业队列 CLI；列表、快照与等待                            |
| `pnpm job:worker`     | 消费持久作业队列；需先注册业务作业                            |
| `pnpm smoke:jobs`     | 作业队列冒烟测试；使用 TEST_DATABASE_URL，不依赖 HTTP/业务    |
| `pnpm agent:game`     | 数据库驱动的 agent CLI；建局、推进、探针、故事与快照          |
| `pnpm agent:api`      | 对运行中的服务端做 HTTP API 走查                              |

## 工具

**Agent CLI**：`agent:game` 直连 PostgreSQL、`agent:api` 一次调用发一次 HTTP 请求；子命令以 `--help` 为准，边界见 `docs/debug-workflow.md`。

**图像生成**：`pnpm image` 是独立 CLI，不启动服务端或数据库；设计与边界见 `docs/image-generation.md`，子命令以 `--help` 为准。

**后台作业**：`pnpm job` 查看队列，`pnpm job:worker` 消费作业；HTTP 接入前都是独立工具，设计与边界见 `docs/background-jobs.md`。

**截图**：`pnpm screenshot` 默认输出 `screenshots/index-1280x900.png`，可用 `--size`、`--base`、`--click` 覆盖；脚本走 CDP 并等待 React 挂载，找不到 Chrome 时用 `CHROME_PATH` 指定。

**pi 扩展**：`.pi/extensions/` 在 pi 启动时自动加载，提供 `deepseek_search`、`deepseek_fetch`、`vision`，读取 pi 进程环境中的 `DEEPSEEK_API_KEY`。密钥只在根 `.env` 时，用 `set -a; source .env; set +a; pi` 启动；改完扩展要重启 pi。

## 排错

| 现象                                                | 处理                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `EADDRINUSE`                                        | 结束占用进程，或修改 `.env` 的 `PORT`                               |
| 页面无法连接服务端                                  | 确认 `pnpm dev:server` 已启动；检查 `VITE_API_BASE_URL` 是否指错 IP |
| 浏览器报 CORS                                       | 开发期用 `CORS_ORIGINS=*`；生产环境填页面来源（协议 + 主机 + 端口） |
| 局域网其它设备访问不了                              | 确认 `HOST=0.0.0.0`，放行防火墙，使用 en0 地址而不是 VPN 地址       |
| `Cannot find module '@ai-trpg/api-client'` 类型缺失 | 运行 `pnpm gen:api`                                                 |
| 修改 `.env` 后 Web 没变化                           | 重启 `pnpm dev:web`                                                 |
| 修改路由后客户端类型没更新                          | 运行 `pnpm gen:api` 并重启 TypeScript 语言服务                      |

开发期想彻底重来：`DROP SCHEMA drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;` 后重跑迁移与 demo 数据。**`drizzle` schema 里是迁移记录**，只丢 `public` 会让 migrate 以为旧迁移已应用，随后在「表不存在」上失败。

## 部署

`pnpm install --frozen-lockfile && pnpm build`，然后 `pnpm --filter @ai-trpg/server start` 启动服务端（产物 `apps/server/dist/index.js`），`apps/web/dist/` 交给 nginx / Caddy 静态托管。生产配置用进程环境变量覆盖 `.env`；`VITE_API_BASE_URL` 在构建时写入前端，API 与页面同源反向代理时设为页面域名并把 `/api/` 转发到服务端。生产环境 `CORS_ORIGINS` 填具体来源。健康检查 `curl http://127.0.0.1:8787/api/v1/health`。

## 文档

- 引擎与系统：[`docs/`](docs/README.md)，从索引进。
- 内容与剧本：与 seed 同目录（如 `apps/server/seeds/dark-fantasy/bell-monastery.md`）。
- 使用与工具链：本文件。

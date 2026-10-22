# 本地开发

## 启动

需要 Node.js >= 22；pnpm 12 由 `packageManager` 固定，可先执行 `corepack enable`。

首次启动依次执行 `pnpm install`、可选的 `cp .env.example .env`、`pnpm db:migrate`、`pnpm db:demo`、`pnpm dev`。`pnpm dev` 会先离线生成 API 契约，再并行启动服务端与客户端。数据库使用本机 PostgreSQL；先创建 `ai_trpg_dev` 与 `ai_trpg_test`，并在根 `.env` 填好 `DATABASE_URL` 与 `TEST_DATABASE_URL`。测试库由数据库测试在运行时自行迁移。

Vite 会打印 Local 与 Network 两个地址；局域网访问使用 Network（en0）那条。页面显示「已连接」即链路正常。服务端健康检查为 `curl http://<局域网 IP>:8787/api/v1/health`。

修改 `.env` 后必须重启 dev；Vite 只在启动时读取环境变量。

## 局域网访问

服务端默认 `HOST=0.0.0.0`；客户端未配置 `VITE_API_BASE_URL` 时，按页面主机名推导服务端地址。开发期 `CORS_ORIGINS=*`，换 IP 不触发跨域。其它设备无法访问时，先确认地址不是 localhost，再检查系统防火墙是否放行 Node / Vite 入站连接。

需要固定后端地址时，在根 `.env` 设置 `VITE_API_BASE_URL=http://<en0 IP>:8787` 并重启。IP 由 DHCP 分配，变化后需同步；建议路由器做 MAC 绑定。

→ 参见：[架构与契约](architecture.md)

## 环境变量

仓库根只有一份 `.env`，server / web 共用。优先级：进程环境变量 > `.env` > `@ai-trpg/shared` 默认值。

| 变量                  | 默认值    | 说明                                                           |
| --------------------- | --------- | -------------------------------------------------------------- |
| `HOST`                | `0.0.0.0` | 服务端监听地址；只允许本机访问时改成 `127.0.0.1`               |
| `PORT`                | `8787`    | 服务端端口                                                     |
| `CORS_ORIGINS`        | `*`       | 允许的浏览器来源；`*` 仅用于开发，生产请填具体来源（逗号分隔） |
| `LOG_LEVEL`           | `info`    | pino 日志级别                                                  |
| `VITE_API_BASE_URL`   | 留空      | 客户端请求的服务端地址；留空时取页面主机名 + 8787              |
| `VITE_DEV_PORT`       | `5373`    | Vite dev server 端口                                           |
| `DEEPSEEK_API_KEY`    | 空        | DeepSeek 密钥                                                  |
| `REPLICATE_API_TOKEN` | 空        | Replicate 密钥                                                 |
| `LLM_DUMP_ENABLED`    | 关闭      | 是否把 LLM 对话留痕写入 `logs/llm`                             |
| `DATABASE_URL`        | 本机 dev  | 开发库连接串                                                   |
| `TEST_DATABASE_URL`   | 本机 test | 测试库连接串                                                   |
| `DB_POOL_MAX`         | `10`      | 连接池上限                                                     |

手动配置 `VITE_API_BASE_URL` 时，改端口需与 `PORT` 同步；`CORS_ORIGINS=*` 时无需跟着改。

## 常用命令

- `pnpm pipeline`：install → 契约 → 检查 → 测试 → 构建 → dev。
- `pnpm verify`：只跑检查链，不启动服务。
- `pnpm dev` / `pnpm dev:server` / `pnpm dev:web`：启动全部 / 仅服务端 / 仅客户端。
- `pnpm gen:api`：重新生成 `openapi.json` 与 `schema.d.ts`。
- `pnpm typecheck`、`pnpm lint`、`pnpm format`：类型、检查、格式化。`lint` 同时运行 Biome、端口守卫与 Markdown 检查；`lint:md` 可单独检查 Markdown。
- `pnpm test:run`：服务端与 Web 测试单次运行。
- `pnpm build`：契约 + 服务端打包 + Web 生产构建。
- `pnpm smoke:deepseek`：真实调用 DeepSeek 的冒烟测试；`smoke:deepseek:full` 额外跑多工具与模型矩阵；`smoke:deepseek:dump` 在 `LLM_DUMP_ENABLED=true` 时写入对话留痕。
- `pnpm agent:game` / `pnpm agent:api`：开发期 agent 的快照入口与 HTTP 走查入口。
- `pnpm db:migrate` / `db:check` / `db:seed` / `db:reset` / `db:demo`：迁移、探测、demo 数据、定点清空、演示初始化；`db:reset` 需要 `--yes`。
- `pnpm agent:game create --user demo`、`status`、`npc`、`snapshot`：从数据库创建并推进黑暗奇幻 NPC 回合；每个 NPC 带物品、技能与状态容器；`npc` 使用 DeepSeek，需要 `DEEPSEEK_API_KEY`。
- `pnpm agent:game take-control` / `release-control` / `player-communicate` / `player-attack`：玩家接管 actor 后直接沟通或攻击。

→ 参见：[开发期 Agent 工作流](debug-workflow.md) → 参见：[数据库](database.md)

## 测试与契约

服务端测试通过 `app.inject()` 直接调用路由，不占用端口；Web 测试使用 jsdom 并 stub `fetch`。契约生成不需要先启动服务端，服务端路由改动后必须重新运行 `pnpm gen:api`，否则客户端类型仍是旧的。

## 生产构建

执行 `pnpm build` 后，服务端产物为 `apps/server/dist/index.js`，可用 `pnpm --filter @ai-trpg/server start` 启动；Web 产物在 `apps/web/dist`，交给静态服务器。生产环境建议用进程环境变量覆盖 `.env`。

## UI 截图

先启动 dev server，再执行 `pnpm screenshot`；默认输出 `screenshots/index-1280x900.png`。可用 `--size 1024x768`、`--base http://...` 覆盖，`--click "按钮文字"` 在截图前连点（`|` 分隔）。脚本走 CDP 并等待 React 挂载；依赖本机 Chrome / Chromium，找不到时用 `CHROME_PATH` 指定。

## pi 扩展

`.pi/extensions/` 下的扩展在 pi 启动时自动加载，提供 `deepseek_search`、`deepseek_fetch`、`vision`。它们读取 pi 进程环境中的 `DEEPSEEK_API_KEY`；密钥只在根 `.env` 时，用 `set -a; source .env; set +a; pi` 启动。修改扩展后重启 pi。搜索与识图按 DeepSeek 计费。

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

→ 参见：[开发规范](conventions.md)

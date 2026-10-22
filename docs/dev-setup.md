# 本地开发

## 环境要求

- Node.js >= 22（本仓库在 22.23.2 上验证）
- pnpm 12（`package.json` 的 `packageManager` 字段已固定；可先 `corepack enable`）

## 首次启动

```bash
pnpm pipeline
```

等价于 `pnpm install && pnpm gen:api && pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && pnpm dev`。

`pnpm dev` 会先运行 `pnpm gen:api` 生成契约，再并行启动服务端与客户端。终端会打印 Vite 的 Network 地址：

```text
➜  Local:   http://localhost:5373/
➜  Network: http://192.168.x.x:5373/  en0
```

浏览器打开 **Network 那条（en0）**，页面应显示「已连接」，并列出服务端版本、运行时长与请求延迟。

## 局域网 / 真机访问（默认就是这条路）

本项目默认按局域网地址工作，而不是 localhost：
- 服务端默认 `HOST=0.0.0.0`，监听所有网卡；
- 客户端未配置 `VITE_API_BASE_URL` 时，自动请求「当前页面主机名 + 8787」，用 IP 打开页面就走 IP；
- 开发期 `CORS_ORIGINS=*`，换 IP 不会触发跨域。

### 查本机 en0 地址

```bash
# macOS
ifconfig en0 | grep "inet "
# Linux
ip addr show
```

### 固定后端地址（可选）

在根 `.env` 中写入（IP 换成上一步查到的）：

```dotenv
VITE_API_BASE_URL=http://192.168.x.x:8787
```

然后重启 `pnpm dev`。IP 由 DHCP 分配，变化后需要同步修改；建议路由器上做 MAC 绑定。

### 验证

```bash
curl http://192.168.x.x:8787/api/v1/health
```

其它设备访问时若被系统防火墙拦截，需要在系统设置里放行 Node / Vite 的入站连接。

## 环境变量

仓库根目录只有一份 `.env`，server / web 共用。优先级：进程环境变量 > `.env` > `packages/shared` 默认值。不建 `.env` 也能启动。

| 变量                  | 默认值    | 说明                                                           |
| --------------------- | --------- | -------------------------------------------------------------- |
| `HOST`                | `0.0.0.0` | 服务端监听地址；只允许本机访问时改成 `127.0.0.1`               |
| `PORT`                | `8787`    | 服务端端口                                                     |
| `CORS_ORIGINS`        | `*`       | 允许的浏览器来源；`*` 仅用于开发，生产请填具体来源（逗号分隔） |
| `LOG_LEVEL`           | `info`    | pino 日志级别                                                  |
| `VITE_API_BASE_URL`   | 留空      | 客户端请求的服务端地址；留空时取页面主机名 + 8787              |
| `VITE_DEV_PORT`       | `5373`    | Vite dev server 端口                                           |
| `DEEPSEEK_API_KEY`    | 空        | DeepSeek 密钥（待填）                                          |
| `REPLICATE_API_TOKEN` | 空        | Replicate 密钥（待填）                                         |

改端口时 `PORT` 与 `VITE_API_BASE_URL` 要一起改（若手动配置了后者）；`CORS_ORIGINS=*` 时无需跟着改。

## 常用命令

```bash
pnpm pipeline       # 一条龙：install → 契约 → 检查 → 测试 → 构建 → dev
pnpm verify         # 只跑检查链，不启动服务
pnpm dev            # 契约 + server + web
pnpm dev:server     # 只启动服务端
pnpm dev:web        # 契约 + 客户端
pnpm gen:api        # server schema → openapi.json → schema.d.ts
pnpm typecheck      # 全仓 tsc --noEmit
pnpm lint           # Biome + 端口守卫
pnpm format         # 格式化
pnpm test:run       # 服务端 + Web 测试（单次）
pnpm build          # 契约 + server 打包 + web 生产构建
```

## 验证连通性

```bash
curl http://192.168.x.x:8787/api/v1/health
```

预期返回：

```json
{
  "status": "ok",
  "service": "ai-trpg-server",
  "version": "0.1.0",
  "apiVersion": "v1",
  "uptimeSeconds": 12,
  "serverTime": "2026-01-01T00:00:00.000Z"
}
```

在页面上停止服务端（`Ctrl+C`），状态应变成「连接失败」；重新启动后，最多 5 秒自动恢复「已连接」。

## 生成契约

```bash
pnpm gen:api
```

不需要先启动服务端。产物：
- `packages/api-client/openapi.json`
- `packages/api-client/src/schema.d.ts`

两者都在 `.gitignore` 中。服务端路由改动后必须重新生成，否则客户端类型仍是旧的。

## 测试

```bash
pnpm test                      # 全部
pnpm --filter @ai-trpg/server test
pnpm --filter @ai-trpg/web test
```

服务端测试通过 `app.inject()` 直接调用路由，不占用端口；Web 测试使用 jsdom 并 stub `fetch`。

## 生产构建

```bash
pnpm build
pnpm --filter @ai-trpg/server start   # node dist/index.js
```

服务端已打包为单文件 ESM（workspace 源码一并打入）。启动时仍从仓库根 `.env` 读取配置；生产环境建议用进程环境变量覆盖。

## UI 截图（视觉核对）

```bash
pnpm screenshot                 # 默认拍 /，输出 screenshots/index-1280x900.png
pnpm screenshot / --size 1024x768
pnpm screenshot / --click "立即重试"
```

- 需要先启动 dev server（`pnpm dev` 或 `pnpm dev:web`）。
- 默认地址是 `http://<en0 IP>:<VITE_DEV_PORT>`，可用 `--base http://...` 覆盖。
- 走 CDP 而不是 `chrome --headless --screenshot`，会等 React 挂载；`--click` 可按按钮文字或 `aria-label` 连点（`|` 分隔）。
- 输出在仓库根 `screenshots/`，已 gitignore；依赖本机 Chrome / Chromium，找不到时用 `CHROME_PATH` 指定。

## pi 扩展

`.pi/extensions/` 下的两个扩展会在 pi 启动时自动加载：

| 文件                 | 注册的工具                           | 用途                      |
| -------------------- | ------------------------------------ | ------------------------- |
| `deepseek-search.ts` | `deepseek_search` / `deepseek_fetch` | 联网搜索与网页正文抓取    |
| `deepseek-vision.ts` | `vision`                             | 图片理解 / OCR / 截图分析 |

两者都需要 pi 进程环境里有 `DEEPSEEK_API_KEY`。如果密钥只在根 `.env` 里，启动 pi 前先导入：

```bash
set -a
source .env
set +a
pi
```

新增/修改扩展后重启 pi 生效。搜索与识图均按 DeepSeek 官方计费，不要在无关任务里频繁调用。

## 排错

| 现象                                                | 处理                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `EADDRINUSE: address already in use 0.0.0.0:8787`   | 结束占用进程，或显式修改 `.env` 的 `PORT`                           |
| 页面提示无法连接服务端                              | 确认 `pnpm dev:server` 已启动；`VITE_API_BASE_URL` 指到了错误 IP    |
| 浏览器报 CORS                                       | 开发期用 `CORS_ORIGINS=*`；生产环境需包含页面来源（协议+主机+端口） |
| 局域网其它设备访问不了                              | 确认 `HOST=0.0.0.0`，并放行防火墙；用 `en0` 地址而不是 VPN 地址     |
| `Cannot find module '@ai-trpg/api-client'` 类型缺失 | 运行 `pnpm gen:api`                                                 |
| 修改 `.env` 后 Web 没变化                           | 重启 `pnpm dev:web`（Vite 只在启动时读取 env）                      |
| 修改路由后客户端类型没更新                          | 运行 `pnpm gen:api` 并重启 TypeScript 语言服务                      |

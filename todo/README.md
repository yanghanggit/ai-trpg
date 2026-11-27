# 待办与交接

给「刚接手这个仓库、或上下文被重置」的人和 agent 用：先读本页，再按索引进具体文件。

**这里的记录会过期**——代码与测试才是事实源。做完一条就在对应文件里删掉它，并把仍然成立的结论挪进 `docs/`（引擎知识）或代码注释。本目录不参与 `docs/` 的索引，也不受它的写作约束；`pnpm lint` 的 markdown 检查仍然覆盖这里。

## 现在到哪一步

服务器侧闭合：回合全部走作业（入队 → 执行 → 终态 → 可查/可撤/可订阅），有进度、有取消、有推送。web 侧接上了**单步回路**：接管 → 提交一个动作或推进一步（agent 席位）/ 空过（玩家席位） → 终态 → 重读投影与顺位 → 刷新后接上正在跑的回合。

运维侧另有一个独立产物 `apps/admin`：身份 / 节点 / 局 / 轨迹 / 事件流 / 记忆 / 系统提示词 / 快照 / 故事各自成页，能推进回合与做危险操作。控制台顶部一张世界图谱（舞台图 + 顺位条），点进去按舞台 → actor → 道具逐层看；推进面板只有「下一个」一个按钮：它自己开顺位、收工、补 world、推一位角色与他的舞台；面板上是按名次排的编排表，舞台跟着人走，本轮状态来自回合账（`action_order_turns`）。它还缺的是「撤掉正在跑的作业」、作业总览与图谱的检索框。

web 还没做的是「让回路在真界面里顺滑」：取消入口、订阅入口、作业历史视图，以及一次真机走查。动作种类停在 4 种（说/看/走/等），是刻意冻结的。

## 索引

| 文件 | 记什么 |
| --- | --- |
| [客户端回路](web-cs-flow.md) | web 侧待办：停止、订阅、作业历史、走查清单与观察点 |
| [服务器遗留](server-debt.md) | 归档策略、SSE 限流、取消边界等，含各自的触发条件 |
| [内容与验收](content-verify.md) | 种子缺敏捷装备、多舞台走查、收尾路径 |
| [管理后台](admin-console.md) | 控制面还没做的事，与几个先别动的边界 |
| [已定的取舍](decisions.md) | 不再讨论的决定；改它之前先读理由 |

## 关键命令

- `pnpm dev`：服务端与页面一起起（一个命令两个进程，端口见 `.env.example`）
- `pnpm test`：server + web + admin 三套；`pnpm typecheck`；`pnpm lint`（biome + 端口 + mock 隔离 + 客户端范围 + markdown）
- `pnpm gen:api`：重生成 `packages/api-client`（契约改动后必须跑，生成物已 gitignore）
- `pnpm --filter @ai-trpg/server jobs:prune`：只报告孤儿作业；加 `--apply` 才真删
- `pnpm agent:api --help`：开发期 HTTP 客户端，逐条对应业务端点（回合、作业、顺位、接管、玩家动作）

## 关键文件

- 回合与作业：`apps/server/src/game-ops/turn-jobs.ts`（四个入口、串行键、进度、取消）、`apps/server/src/jobs/`（队列、worker、进度、取消、`LISTEN/NOTIFY` 广播）
- 作业的 HTTP 面：`apps/server/src/routes/games.ts`（列表 / 读取 / 取消）、`apps/server/src/routes/job-stream.ts`（SSE）
- web 的回路：`apps/web/src/features/turns/`（编排、入队、轮询、订阅、寻址）、`apps/web/src/pages/game/TurnDialog.tsx`（容器）、`panels/ActionForm.tsx` 与 `panels/OrderPanel.tsx`（纯展示）
- 运维台：`apps/admin/src/components/PageHeader.tsx`（页头与导航）、`pages/game/`（一局的七个页）、`pages/game/graph/`（世界图谱：布局纯函数 + xyflow 画布）、`pages/overview/`（身份与节点）
- 图谱的读：`apps/server/src/game-ops/graph.ts`（活状态的另一个切面）、`apps/server/src/routes/schemas/graph.ts`（线上契约）
- 提示词导出的读：`apps/server/src/debug/prompt-dump.ts`（写盘与 `manifest.json`）、`apps/server/src/game-ops/prompts.ts`（按局认领、整包读回）
- 契约：`packages/api-client` 由 openapi 生成；`docs/` 里 `turn-jobs.md`、`background-jobs.md`、`web-client.md` 是这三块的所有者

## 现在的验证位置

`apps/server` 775 passed / 1 skipped，`apps/web` 50 passed，`apps/admin` 42 passed；`pnpm typecheck`、`pnpm lint` 全绿。数据库只有一份基线迁移（`apps/server/drizzle/0000_baseline.sql`），改 schema 的方式见 `docs/database.md` 与待办里的说明。

# 管理后台（未做）

`apps/admin` 的形状由代码自述：页头与导航在 `components/PageHeader.tsx`、`components/GamePageLinks.tsx`，
一局的七个页在 `pages/game/`，机器读数在 `routes/status.ts` 与 `pages/overview/`。
本页只记**还没做的事**。

## 未做

1. 「能看什么」的判定收进一处：现在 `requireGameAccess`（路由）与 `listGamesOp`（列表）各写一次 `isAdmin`。
2. 跨局 `GET /jobs`：运维视角的作业总览。做完之后补上「取消作业」入口——现在界面上撤不掉正在跑的回合。
3. 会话令牌 + `users.role`：落地时删掉 `apps/server/src/identity.ts` 的名单，只改 `plugins/auth.ts` 一处。
4. 故事总结改入队：它现在是同步长请求（多轮 LLM、没有作业行、不能取消）。改之前先定「故事算不算一次回合」。
5. 多节点：`/status` 只描述当前进程，后台也只连 `VITE_API_BASE_URL` 那一个；要有第二个服务端才谈汇总。
6. 系统提示词导出只有单份阅览：同一剧本两次建局之间差在哪，现在得自己对着两份看。要做得先定「比哪一层」——world、职能、舞台、角色四类各自比，还是逐字比整份。
7. 推进面板只显示步骤日志与终态：回合账里已经有对账三元组（期望名次 / 实际名次 / 是否一致），
   但面板还没把它读出来——下一步是把这三列摆进编排表。
8. 舞台节点上还没有本轮状态：`worldFlow` 只算人数与「轮到」，账上「这个舞台的谁已经动过」只体现在
   舞台页的「本行动轮」块里。要让图上一眼看见，得给 `StageNode` 加一份按顺位排的演员摘要。
9. 图谱的检索框：`pages/game/graph/viewModel.ts` 的 `entityIndex` 已把舞台 / actor / 道具归一成
   `kind / id / label / stageId`，只差一个输入框与 `fitView` 定位——节点一多，点图找东西会先失效。

## 现在的边界（条件不到就不动）

- **不是登录**：`Authorization: Bearer <username>`，用户名即令牌；真正拦住外人的是「只监听 `127.0.0.1`」。
- **名单不是角色**：`admin` / `demo` 是两行用户加一张写死名单，`users` 表没有 `role` 列。
- **轨迹跨全部局**：`/traces` 是整台机器的调试口径，别拿它当「某局的历史」。
- **产物读本机磁盘**：快照、故事与提示词导出都在服务端进程的 `logs/` 下，多进程时各看各的。

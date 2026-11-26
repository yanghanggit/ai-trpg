# 管理后台

`apps/admin`：控制面的图形界面。它读的是全知视图（活状态、轨迹、记忆、探针），和 `apps/web`
的观看者投影是两套读者；把两者并进一个产物会让遮蔽与全知在同一个响应里打架。

## 现在的形状

- 独立 Vite 应用，`apps/*` 工作区自动包含；`pnpm dev` 会一起起，端口见 `.env.example`。
- 只监听 `127.0.0.1`，不随局域网暴露，也不承诺随生产部署——它目前是运维台，不是产品面。
- 身份沿用 web 的开发期用户名（`Authorization: Bearer <username>`），因此**只能看到该 owner 名下的局**。
- 总览页：健康、身份、轨迹读数、名下的局（`GET /games`）、按 slug 打开一局。
- 局控制台：作业列表与取消、三层回合推进、空过、活状态原文、事件流、轨迹与单回合事件、
  记忆 / 真名扫描 / 探针 / 快照 / 故事总结 / 压缩记忆、结束与删除一局。
- 写操作一律「二次确认 + 重读作业终态」：入队成功不算回合发生过，`canceled` 与 `succeeded`
  都只以重读的那个作业行为准。

## 已知缺口

- **权限停在 A**：owner 口径。跨 owner 排查需要 `ADMIN_USERNAMES` 白名单绕过 `requireGameAccess`，
  再往后才是 `users.role`。两者都等到真登录体系一起做时更省事。
- **没有守卫**：`scripts/check-client-scope.mjs` 只守住「web 不读控制面」。反方向的
  「admin 不读 `ActorView`」没有必要——后台看玩家视角是为了对照，不是缺陷。

## 下一步

1. 需要跨 owner 时再加白名单（`ADMIN_USERNAMES`），并把可见性判定收进一处——现在
   `requireGameAccess` 与 `listGamesOp` 各写一遍「owner 名下」。
2. 后台如果需要盯全部作业而不只是某局的，再补跨局 `GET /jobs`；那属于运维视角，与回合视图分开。

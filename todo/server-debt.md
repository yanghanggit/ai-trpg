# 服务器遗留

都有明确的触发条件，不到条件就不动。改之前先读 [已定的取舍](decisions.md)。

## 1. 作业归档与清理（策略未定）

现状：作业行一直留着，删局**不会**级联清它们（作业没有外键，局 id 在 payload 里）。所以删局之后这些行就是孤儿：读作业会因局不存在回 404，但行还在。

已给的工具：`pnpm --filter @ai-trpg/server jobs:prune` 只报告孤儿，加 `--apply` 才删。它只碰「payload 带 `gameId` 且那一局已不存在」的行。

- 触发：作业表开始碍事（排查时噪音大、或行数影响查询）时，先定策略再谈实现：按终态时间归档、按局级联、还是保留最近 N 天。
- 不要偷偷改成「删局级联」：那等于在没有策略的情况下做了不可逆决定。

## 2. SSE 限流与连接管理（触发条件已满足）

现状：没有连接上限、没有单流寿命、没有慢消费者丢弃。单机单人开发够用。

- **触发条件已经满足**：服务端与两个前端都监听 `0.0.0.0`，后台也能走局域网——任何人挂着 `/traces` 的流都不会被踢。上线前必须先补最小面（连接上限 + 单流寿命 + 写失败即断）。
- 做法：按用户/IP 的连接上限、单条流的最长寿命、写失败即断开、慢消费者直接丢。
- 与它同源的一条：`ADMIN_TOKEN` 只是共享口令，不看是谁——真要区分观看者，仍得等会话令牌。

## 3. 执行中取消的边界（是设计，不是缺陷）

取消只在**落账开始之前**生效。进了写事务之后这一回合必须跑完，取消请求被忽略、作业以 `succeeded` 收尾；结算后的增量推理（外观、掉落）也不打断。

- 想改成更早中断也行，但要先回答「半份世界怎么办」——当前答案是「宁可不落账也不留半份」，所以窗口只开到落账前。
- 相关：`docs/turn-jobs.md`、`docs/background-jobs.md`。

## 4. worker 的取消轮询是每个作业每秒一次查询

`concurrency=2` 时无感。扩并发之前改成一次批量查（所有 running 作业的 `cancel_requested`）。

## 5. 队列层的其它遗留

- `jobs` 用 `turn:<gameId>` 字符串当分组键（`serialization_key`）。多业务共用作业表时，应该落一个正式的 `game_id` / scope 列。
- `max_attempts` 对回合作业固定 1：落账不幂等，整回合不自动重试，重试归客户端。别看到失败就加自动重试。

## 改 schema 的方式

仓库只有一份基线迁移 `apps/server/drizzle/0000_baseline.sql`，开发期不留迁移历史：

1. 改 `apps/server/src/db/schema.ts`；
2. `pnpm --filter @ai-trpg/server db:generate --name baseline`（先把 `apps/server/drizzle/` 清空再生成）；
3. 两个库都重置：`drop schema public cascade; drop schema drizzle cascade; create schema public;`；
4. `pnpm db:migrate`（dev 与 test 各一次，test 用 `DATABASE_URL=$TEST_DATABASE_URL` 的形式），再 `pnpm db:demo`。

# 数据库

PostgreSQL 是游戏状态的唯一真相。当前 `agent:game` 已从数据库读取并在短事务内修改状态；HTTP 服务端接入后复用同一服务层。进程重启不改变游戏状态。

## 当前模型

第一条垂直切片使用以下关系：

- `users`：账号身份，不进入游戏状态。
- `games`：一局游戏，聚合根；拥有 `owner_id`、稳定 `slug`、状态、内容版本与并发版本号。
- `game_players`：游戏中的参与者；v1 用唯一索引限制一局只有一个 player。
- `worlds`：游戏的世界状态，`game_id` 唯一，强制一局一个 world。
- `stages`：world 下的场景；`world_id` 非空，按 `ordinal` 保持稳定顺序。
- `stage_connections`：场景图的有向边；连接两端必须属于同一 world。
- `actors`：场景中的角色；`stage_id` 非空，不能脱离场景存在；`controller_player_id` 指向玩家的控制关系。
- `items`：角色持有的物品；`actor_id` 非空，不能脱离角色存在。
- `game_messages`：按 `sequence` 追加的消息流，供客户端增量拉取与 agent 阅读；不建立 session 表。

`world` 是 game 的运行时子状态，不是可复用内容模板。后续若需要多个游戏复用同一世界，再引入独立的 world template 与实例复制，不修改当前 1:1 语义。

数据库 `worlds` 与文件目录 `worlds/` 同名但职责不同：前者是运行时状态，后者是导出的开发期快照。

## 开发数据

`seeds/dark-fantasy.ts` 提供黑暗奇幻的战役设定、全局规则、两个场景、一条连接、一个角色与一件物品；故事内容留在 seed 层，不写进服务逻辑。

`pnpm db:demo` 应用迁移、清空登记过的开发表、写入固定 demo 用户与 `app_meta`。随后由 `pnpm agent:game create --user demo` 创建一局游戏；创建过程同时生成唯一 player、world、stage 图、actor 与 item。

## 最小动作

当前只有一个确定性动作：沿场景连接移动玩家控制的 actor 到目标 stage。

动作在事务中锁定 game 行，校验目标 stage 与连接，更新 actor 的 `stage_id`，递增 game 版本，追加一条 player 消息与一条 narration 消息，然后提交。并发提交同一局时由行锁串行化；不同 game 互不阻塞。

`agent:game act --game <gameId|slug> --action move --to <stageId|stageName>` 驱动该动作。`agent:game status` 读取完整 game 状态；`agent:game snapshot` 将当前状态导出到 `worlds/<user>/<gameSlug>/<snapshotId>/`。

## 迁移与重置

schema 定义在服务端代码中，SQL 迁移由 Drizzle Kit 生成并入库。迁移是唯一建表路径，不在应用启动时调用隐式同步。

`pnpm db:migrate` 应用迁移；`pnpm db:reset --yes` 清空显式登记的开发表；`pnpm db:check` 探测连接与基础设施表。重置清单集中在 `src/db/maintenance.ts`，新增业务表必须登记。`db:reset` 与 `db:demo` 只允许本机数据库；数据库重置不会删除 `worlds/` 下的历史快照，需要时手动清理。

## 事务边界

LLM 调用不放进数据库事务。需要模型的业务动作应先读取状态、在事务外生成，再用版本号或行锁提交；不持有数据库锁等待模型返回。

快照是提交后的只读投影，不是第二套状态源。快照失败只记录日志，不回滚业务；正式环境通过开关关闭落盘。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

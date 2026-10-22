# 数据库

PostgreSQL 是游戏状态的唯一真相。服务端不再把权威世界对象留在进程内存里；一次业务动作读取数据库、在事务内修改、提交，进程重启不改变游戏状态。

当前只建立了数据库基础设施：连接池、迁移、开发期重置与占位 seed。`app_meta` 用于验证链路，不承载领域状态；角色、舞台、世界等表随第一个业务切片再引入，避免在领域未定时提前固化 schema。

## 本地实例

开发使用本机 PostgreSQL，不引入 Docker。仓库根 `.env` 提供 `DATABASE_URL` 与 `TEST_DATABASE_URL`，分别指向 `ai_trpg_dev` 与 `ai_trpg_test`。数据库名使用下划线，避免 SQL 标识符引号。

本机 Homebrew PostgreSQL 对本地 TCP 使用 trust，当前可直接以本机用户连接；正式环境必须使用独立角色、密码与最小权限。

现有旧库 `ai-trpg-db` 属于废弃项目，已删除；新项目不会读取或迁移它。

## 迁移

schema 定义在服务端代码中，SQL 迁移由 Drizzle Kit 生成并入库。迁移是唯一建表路径，不在应用启动时调用 `create_all` 或隐式同步 schema。

首次或 schema 变更后执行 `pnpm db:generate` 生成迁移，再执行 `pnpm db:migrate`。测试库由数据库测试在运行时自行迁移。部署时迁移是显式步骤，服务端启动不自动改 schema。

## 开发数据

`pnpm db:check` 只读探测连接、数据库名、版本与 `app_meta` 行数。`pnpm db:seed` 写入占位数据，`pnpm db:reset` 清空显式登记的开发表，`pnpm db:demo` 依次执行迁移、重置与占位 seed。

`db:reset` 必须带 `--yes`；`db:reset` 与 `db:demo` 只允许本机数据库。重置清单集中在一处，新增业务表必须登记，避免误删迁移表或扩展。当前 seed 是占位实现，第一个业务切片会替换为确定性的测试数据与初始快照。

## 事务边界

领域动作的默认形态是短事务：读取状态、校验规则、写入变更、追加事件、提交。LLM 调用必须在事务外完成，再以版本号或行锁提交结果；不持有数据库锁等待模型返回。

快照是提交后的只读投影，不是第二套状态源。快照失败只记录日志，不回滚业务；正式环境通过开关完全关闭落盘。具体投影格式与 agent 入口在业务切片接入后补充。

→ 参见：[架构与契约](architecture.md) → 参见：[开发期 Agent 工作流](debug-workflow.md)

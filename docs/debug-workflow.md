# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：数据库驱动的 `agent:game` 直连 PostgreSQL；HTTP 走查的 `agent:api` 逐步请求运行中的业务服务端。两者都必须复用同一套业务服务层，CLI 只做参数解析、状态读取与结果输出。

## 数据库驱动

子命令与参数以 `pnpm agent:game --help` 为准，这里不复制菜单。要记住的是它的形状：建局必须显式给内容来源，推进必须逐个实体指定，读操作（`status`、`scene-map`、`snapshot`、`probe`、`story`）都不调用 LLM，也不改状态；玩家接管后可用 `player-*` 以该 actor 身份直接提交单个动作，绕过计划与模型。

## 显式推进边界

`agent:game` 能完成内容选择、建局和 actor/stage/world 推进，但不会自动编排回合：`stage` 与 `world` 必须显式执行；`create` 必须显式提供内容；建局不会自动 RAG ingest；compact 不自动触发；旧局不会自动获得新结构。只有 world 能主动 `end_game`；主角死亡只写一条 world 通知，收尾仍然要显式跑 `world` 回合。

## 运行时 system prompt 导出

每次建局成功后，服务层把本局实际使用的 system prompt 写到仓库根 `prompts/<YYYYMMDD_HHmmss>_<世界名>/`：`world.md`（公共设定与规则）、`world-agent.md`、`actors/<角色名>.md`、`stages/<场景名>.md`。同一秒的第二个容器追加 `_2`、`_3`；`PROMPTS_DIR` 可覆盖根目录；导出失败只告警，不影响建局。数据库仍是唯一权威状态。

## 过程轨迹

写进 `logs/trace` 的是一条按局、按天追加的事件流：回合边界、LLM 请求与响应、计划与落账、被拒原因、子阶段结果、观察收件人。字段以代码为准，`trace schema` 自述；子命令以 `agent:game --help` 为准，两者都不在这里复述。

它不是日志流而是文件语料，因为读者顺序是 agent 优先、人其次：跑完之后要能重新读取、用文本工具统计拒绝与失败、跨局跨天对比同一改动前后的行为。数据库会被重置，轨迹不会——这是它不为分析建表的原因。

观察也进轨迹，用来回答「这个角色为什么没反应」：谁收到了哪条观察、或者谁都没收到，都是可归因的事实。子阶段结果分 `ok`、`skipped`、`failed` 三态并带原因：`ok` 只代表确实落了账，跳过与失败都不算增量。增量阶段的统一入口只负责失败收敛与轨迹记录，不承载预算、重试或事务策略。

保留策略以归档为先而不是丢弃：压缩之后读取侧照常可读，只有显式删除才真的丢数据。同一份轨迹还能渲染成人读视图按需落盘，审阅不必另存一份数据。写盘失败只告警，不影响游戏；测试环境默认不写。

进程日志只留启动、失败与降级告警，不承担过程叙事；轨迹回答“为什么”，日志只回答“进程是否健康”，两层不能互相替代。

→ 参见：[LLM 基础组件](llm.md)

## 文件快照

`agent:game` 仍保留手写快照入口：`new` 生成快照，`list` / `latest` / `show` / `validate` 枚举、定位、查看与校验。目录按 `worlds/<user>/<gameSlug>/<snapshotId>/` 组织，含 manifest、world、session 与可选 parts；数据库快照额外记录来源、gameId、库版本与内容版本，并导出 actor/stage/world 的私有 memory。快照是提交后的只读投影，不是写入源；分支与回溯由数据库层负责。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束。当前命令是 `health`、`openapi` 与通用 `request`；服务端地址用 `--base` 或 `AGENT_API_BASE_URL`，token 用 `--token` 或 `AGENT_API_TOKEN`。它用于探索与边界试探，不替代 `app.inject()` 回归测试。

→ 参见：[架构与契约](architecture.md)、[数据库](database.md)

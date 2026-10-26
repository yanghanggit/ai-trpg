# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：数据库驱动的 `agent:game` 直连 PostgreSQL；HTTP 走查的 `agent:api` 逐步请求运行中的业务服务端。两者都必须复用同一套业务服务层，CLI 只做参数解析、状态读取与结果输出。

## 数据库驱动

以下命令均以 `--game <id|slug>` 定位对局，建局类用 `--user`；涉及 actor 的命令再加 `--actor <id|name>`。

建局与读取：`create --user demo --seed <name>` 从内容注册表物化 game、座位、world、场景图、角色与各自 memory；`--content-file <path>` 从外部内容包建局，`--world-file <path>` 只提供 world；`status --game <id|slug>` 读取完整状态，`scene-map` 读取场景角色分布且不调用 LLM。

知识：`rag ingest (--seed <name> | --file <pack>)`、`rag search`、`rag check`、`rag delete --collection <name> --yes`；`rag:smoke` 走真实模型，`rag:eval` 跑检索质量评测。

推进：`npc --game <id|slug> --actor <name>` 推进一个 NPC，`--all` 按当前顺序推进全部未接管 NPC；`stage --stage <name>` / `--all` 推进 stage 小 GM；`world` 推进 world 回合。stage 可更新 environment 或 `notify_world`，world 可 `notify_stage` 或 `end_game`。

观测：`probe --actor|--stage --message <text>` 发起只读 memory 探针；`snapshot` 导出只读快照；`story` 生成故事；`compact --owner actor|stage|world|all` 手动压缩 memory，`--min-ratio <0..1>` 低于阈值时跳过。

玩家接管：`take-control` / `release-control`；`player-say|whisper|announce|move|wait|attack|steal|give|pickup|use|equip|unequip` 以被接管 actor 身份直接提交单个动作，不调用 LLM；`player-use --detail <text>` 描述场景中被作用的部位。`appearance --actor <name>` 强制重推外观，`--all` 幂等批量维护；`deaths` 只跑死亡阶段。

→ 参见：[Actor 行动与记忆](actor-actions-memory.md)、→ 参见：[Stage 小 GM](stage.md)

## 显式推进边界

`agent:game` 能完成内容选择、建局和 actor/stage/world 推进，但不会自动编排回合：`stage` 与 `world` 必须显式执行；`create` 必须显式提供内容；建局不会自动 RAG ingest；compact 不自动触发；旧局不会自动获得新结构。只有 world 能主动 `end_game`；主角死亡只写一条 world 通知，收尾仍然要显式跑 `world` 回合。

## 运行时 system prompt 导出

每次建局成功后，服务层把本局实际使用的 system prompt 写到仓库根 `prompts/<YYYYMMDD_HHmmss>_<世界名>/`：`world.md`（公共设定与规则）、`world-agent.md`、`actors/<角色名>.md`、`stages/<场景名>.md`。同一秒的第二个容器追加 `_2`、`_3`；`PROMPTS_DIR` 可覆盖根目录；导出失败只告警，不影响建局。数据库仍是唯一权威状态。

## 文件快照

`agent:game` 仍保留手写快照入口：`new` 生成快照，`list` / `latest` / `show` / `validate` 枚举、定位、查看与校验。目录按 `worlds/<user>/<gameSlug>/<snapshotId>/` 组织，含 manifest、world、session 与可选 parts；数据库快照额外记录来源、gameId、库版本与内容版本，并导出 actor/stage/world 的私有 memory。快照是提交后的只读投影，不是写入源；分支与回溯由数据库层负责。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束。当前命令是 `health`、`openapi` 与通用 `request`；服务端地址用 `--base` 或 `AGENT_API_BASE_URL`，token 用 `--token` 或 `AGENT_API_TOKEN`。它用于探索与边界试探，不替代 `app.inject()` 回归测试。

→ 参见：[架构与契约](architecture.md)、→ 参见：[数据库](database.md)

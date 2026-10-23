# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：

- 数据库驱动：`agent:game` 直接连接 PostgreSQL，不经过 HTTP 服务端。
- HTTP 走查：`agent:api` 逐步请求运行中的业务服务端。

两者最终都必须复用同一套业务服务层。CLI 只负责参数解析、状态读取与结果输出，规则校验、LLM loop、事务与持久化不能各写一份。

## 数据库驱动

`agent:game` 当前支持从数据库创建并推进一局游戏：

- `create --user demo --seed dark-fantasy`：从内容注册表读取世界并创建 game、player 座位、world、stage 图、连接、角色、场景物品、角色物品，以及 actor/stage/world system memory；actor 的 `openingBriefing` 会作为第一条 human message 写入其 memory。`--world-file <path>` 可从外部 JSON 内容建局。
- `status --game <gameId|slug>`：读取完整游戏状态。
- `scene-map --game <gameId|slug>`：读取全场景角色分布（场景名 → 角色名列表），不调用 LLM。
- `rag ingest --seed <name>` / `rag search --seed <name> --query <text>` / `rag check --seed <name>` / `rag delete --collection <name> --yes`：公共知识向量入库与检索；`rag:smoke` 走真实模型。
- `npc --game <id|slug> --actor <actorId|actorName>`：推进一个 NPC 回合。
- `npc --game <id|slug> --all`：按当前 actor 顺序推进所有未被玩家接管的 NPC。
- `stage --game <id|slug> --stage <stageId|stageName>`：推动一个 stage 小 GM 回合，可更新 environment，也可通过 `notify_world` 向 world memory 写入场景报告。
- `stage --game <id|slug> --all`：按当前 stage 顺序推动所有场景。
- `world --game <id|slug>`：推动 world 回合，读取 stage 通知，可 `notify_stage` 下发裁决或 `end_game` 结束游戏。
- `probe --game <id|slug> --actor <actorId|actorName> --message <text>`：向 actor 发起只读 memory 探针，不写 memory、不注入当前 observation、不改变游戏状态。
- `probe --game <id|slug> --stage <stageId|stageName> --message <text>`：向 stage 发起只读 memory 探针，只读取 system prompt 与场景 memory，不注入当前环境或物品。
- `take-control --game <id|slug> --actor <actorId|actorName>`：玩家接管一个 actor。
- `release-control --game <id|slug> --actor <actorId|actorName>`：解除接管。
- `player-say` / `player-whisper --game <id|slug> --actor <actorId|actorName> --target <actorName> --message <text> [--reason <text>]`：以被接管 actor 的身份直接说话或耳语，不调用 LLM。
- `player-announce --game <id|slug> --actor <actorId|actorName> --message <text> [--reason <text>]`：向当前场景公开说话。
- `player-move --game <id|slug> --actor <actorId|actorName> --to <stageName>`：以被接管 actor 的身份沿连接移动，不调用 LLM。
- `player-wait --game <id|slug> --actor <actorId|actorName>`：留在原地。
- `player-steal` / `player-give --game <id|slug> --actor <actorId|actorName> --target <actorName> --item <itemName>`：取物或给予。
- `player-pickup --game <id|slug> --actor <actorId|actorName> --item <itemName>`：拾取当前场景物品。
- `player-use --game <id|slug> --actor <actorId|actorName> --item <itemName> (--target <actorName> | --stage <stageName>) [--detail <text>]`：使用自己的物品；对场景使用时可用 `--detail` 描述锁孔、炉膛等具体部位。
- `player-attack --game <id|slug> --actor <actorId|actorName> --target <actorName> [--item <itemName>]`：以被接管 actor 的身份直接攻击同场景目标，可指定带 `attack` effect 的物品；不调用 LLM。
- `snapshot --game <id|slug>`：把当前状态与每个 actor/stage/world 的 memory 导出为只读快照。

## 显式推进边界

`agent:game` 能完成内容选择、建局和 actor/stage/world 推进，但不会自动编排回合：

- `stage` 与 `world` 必须分别显式执行；
- `create` 必须显式提供 `--seed`、`--world-file` 或 `--world`；
- 建局不会自动执行 RAG ingest；
- 旧局不会自动获得新的 world memory / `worlds.actions` / stage `notify_world` 结构；
- 只有 world 的 `end_game` 能结束游戏，且是否结束由 world 回合决定。

典型流程是：

```bash
pnpm agent:game create --user demo --seed dark-fantasy --slug my-game
pnpm agent:game stage --game my-game --stage "场景.铁闸门"
pnpm agent:game world --game my-game
```

## 运行时 system prompt 导出

每次 `agent:game create` 建局成功后，服务层会把本局**实际使用的** system prompt 写到仓库根目录的 `prompts/` 下（该目录被 `.gitignore` 忽略）：

```text
prompts/<YYYYMMDD_HHmmss>_<world 名>/
  world.md                # 世界级设定与全局规则（actor/stage/world prompt 的公共部分）
  world-agent.md          # world 作为全局叙事者的 system prompt
  actors/<角色名>.md       # 该 actor 的完整 system prompt
  stages/<场景名>.md       # 该 stage 小 GM 的完整 system prompt
```

- 同一秒建两局时，第二个容器追加 `_2`、`_3`，不会互相覆盖。
- 默认只在非测试环境落盘；测试进程设置了 `PROMPTS_DIR` 时仍会导出。
- `PROMPTS_DIR` 可以覆盖根目录（例如导出到临时目录）。
- 导出失败只打印告警，不影响建局；数据库仍是唯一权威状态。

NPC 回合由 agent loop 驱动：先读取环境与私有 memory，再通过工具决定行动。`look_stage`、`get_self`、`observe_actor` 是只读 GET，可多次调用；`get_self` 返回自己的完整信息，`observe_actor` 只返回同场景目标携带的物品；`look_stage` 会显示场景中的 `stage_items`；工具按模型返回顺序串行执行；十个动作工具 `say` / `whisper` / `announce` / `move` / `wait` / `attack` / `steal` / `give` / `pickup` / `use` 各自只接收自己的参数，且只暴露给被允许的角色（见 `actors.actions`）；一轮最多两个动作，不分类互斥，按调用顺序保留；`submit_plan` 是终止工具，handler 只收集计划，不写数据库。loop 结束后服务层在事务中按顺序校验并应用全部动作。`say` 是有目标公开说话，向当前 stage 广播；`announce` 是无目标公开说话；`whisper` 必须指定单个 `targetActorName`，只有发起者与目标进入 memory；`attack` 与 `use` 只做 dispatcher：按 `item.effect` 选择执行器。无词缀 `damage` 的伤害为攻击者 `stats.attack` 加物品 `stats.damage`，减去目标 `stats.defense`，最低 0；默认 effect 执行后，非空 `affixes` 会运行事务外的 affix agent；agent 通过工具收集补充效果，再落账；空手时使用系统 damage effect，只读 actor 的 `stats.attack` 与目标 `stats.defense`；目标物品 block 与发起者物品 block 当前都不参与伤害；目标 `stats.hp` 归零后 `status=dead`，不能再执行 loop。`event` effect 只写使用事件，后果交给 stage / world。`game_messages` 用 `visibility` 区分公开与私密。

它不需要启动 HTTP 服务端，但需要 `DATABASE_URL` 与 `DEEPSEEK_API_KEY`。`agent:game status` 不调用 LLM，可用于观察当前状态。

## 文件快照

`agent:game` 仍保留文件快照命令：

- `new --user <user> --game <game>`：手写一份开发快照。
- `list` / `latest` / `show` / `validate`：枚举、定位、查看与校验。

快照目录按 `worlds/<user>/<gameSlug>/<snapshotId>/` 组织，包含 `manifest.json`、`world.json`、`session.jsonl` 与可选 parts。数据库快照额外记录 `source`、`gameId`、`dbVersion` 与 `contentVersion`，并通过 `memories/<name>.json`、`memories/<name>.meta.json` 导出 actor、stage 与 world 的私有上下文。

快照是数据库提交后的只读投影，用于观察、比对与留痕，不作为写入源。stage 与 actor 的 memory 都会导出。分支与回溯由数据库层负责，不通过修改快照文件实现。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束，便于 agent 判断并自我纠错。

当前命令是 `health`、`openapi` 与通用 `request`；业务动作路由接入后，再增加 `status`、`action` 等快捷命令。服务端地址通过 `--base` 或 `AGENT_API_BASE_URL` 提供，鉴权 token 通过 `--token` 或 `AGENT_API_TOKEN` 注入。

它不替代固定回归测试：可复现的契约校验仍应写成 `app.inject()` 测试；HTTP 走查用于探索、新特性验证与边界试探。

→ 参见：[架构与契约](architecture.md) → 参见：[数据库](database.md)

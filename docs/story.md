# 故事整理 Agent

`story` 是一个只读的叙事整理 agent。它可以在任意时刻运行，读取所有 actor / stage / world 的私有 memory 与公共事件流，输出一段当前故事。

它不是世界内角色，不写 memory，不改变游戏状态，也不写 `game_messages`。CLI 会把故事写到仓库根目录的 `stories/`，该目录内容被 gitignore。

## 入口

```bash
pnpm agent:game story --game <gameId|slug>
```

游戏可以在任意状态运行，包括进行中的 `active` 和已结束的 `completed`。已结束不是必要条件；它只是故事可能拥有明确结局的一种状态。

## Agent 流程

```text
list_memories
  → read_memory(world)
  → read_memory(stage) × N
  → read_memory(actor) × N
  → read_events
  → submit_story
```

`submit_story` 之前必须已经：

- 读取 `list_memories` 返回的每一个实体；
- 调用 `read_events`。

否则提交会被拒绝，并告诉 agent 还缺哪些实体。

## 工具

### `list_memories`

列出本局所有 memory：

```text
ownerType | name | messages | ratio | archived
```

### `read_memory`

读取一个实体：

```text
ownerType: world | stage | actor
name: 实体名
includeArchived?: boolean
```

默认读取当前 memory 视图。  
如果该实体做过 compact，`includeArchived: true` 会递归展开 `compactedMessages` 归档树，用于回述被压缩掉的细节。

### `read_events`

读取全部 `game_messages`，按 `sequence` 排序，保留：

- stage；
- source / target；
- visibility；
- kind；
- content。

### `submit_story`

终止工具，只接收非空 `story`。

## 输出

CLI 输出 JSON：

```json
{
  "ok": true,
  "action": "story",
  "gameSlug": "player-death-e2e",
  "gameStatus": "completed",
  "story": "...",
  "rounds": 5,
  "memoriesRead": ["world:枯钟修道院", "actor:角色.奥德里克"],
  "eventsRead": true,
  "path": "<repo>/stories/20260102_030405_player-death-e2e.md"
}
```

只输出到 CLI 与 `stories/`，不写入数据库。

文件格式：

```text
stories/<YYYYMMDD_HHmmss>_<slug>.md
```

包含游戏名、slug、状态、内容版本、游戏版本、生成时间、agent 轮数、读取的 memory 列表和故事正文。同名文件不会覆盖，会追加 `_2`、`_3`。

## 目录覆盖

```text
STORIES_DIR=/tmp/ai-trpg-stories
```

设置后写入指定目录。测试默认写入临时目录，不污染仓库。

## 叙事约束

agent 的 system prompt 要求：

- 只使用工具返回的记忆和事件；
- 综合不同视角，区分事实、误解与角色认知；
- 保持因果、关系、物品、地点和结局；
- 不编造未出现的事实；
- 不解释机制，不输出分析过程或工具说明；
- 不写“场景/世界/系统/裁决/报告/工具/memory/stage/actor/测试目标”等元语言；
- 不使用 `角色.xxx` / `场景.xxx` 这类实体全名，改用自然称呼；
- 最终提交一段故事，而不是提纲。

## 边界

- 这是开发期观察工具，不是玩家可见功能；
- 不自动在游戏结束时触发，也不要求游戏已结束；
- 不把故事写回数据库；只写 `stories/` 调试文件；
- 不展开归档，除非 agent 显式调用 `includeArchived: true`；
- 不做“故事是否优秀”的自动评分；
- 不参与任何状态推进或结算。

## 测试

单元测试使用脚本化的 fake LLM 走完整工具链，并断言不改变 game version、公共消息与 memory。

真实 E2E：

```bash
pnpm agent:game story --game player-death-e2e
pnpm agent:game story --game e2e-mini
```

前者验证默认玩家死亡结局，后者验证钥匙开门结局；进行中的游戏也可以直接生成当前故事。

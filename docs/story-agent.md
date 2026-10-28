# 故事整理 Agent

`story` 是一个只读的叙事整理 agent：在任意时刻读取全部 actor / stage / world 的私有 memory 与公共事件流，输出一段当前故事。它不是世界内角色，不写 memory、不改变游戏状态、不写 `game_messages`。

## 约束

提交故事前必须已读取 `list_memories` 返回的每一个实体，并调用 `read_events`；缺任何一项，`submit_story` 会被拒绝并告知缺失实体。这是为了阻止 agent 凭摘要或常识补写未读到的视角。

读取默认用当前 memory 视图；显式要求 `includeArchived` 才会递归展开 compact 归档树，用于回述被压缩掉的细节。

## 输出

游戏可在任意状态运行，`completed` 只意味着故事可能有明确结局。CLI 输出 JSON，包含 slug、状态、故事正文、轮数、读取的 memory 列表与文件路径。

文件写到 `stories/<时间戳>_<slug>.md`，目录内容 gitignore；同名不覆盖，追加序号。`STORIES_DIR` 可改写目录，测试默认写临时目录。

## 叙事约束

system prompt 要求 agent：只使用工具返回的记忆与事件；综合不同视角，区分事实、误解与角色认知；保持因果、关系、物品、地点与结局；不编造未出现的事实；不解释机制，不输出分析过程或工具说明；不用「角色.xxx」「场景.xxx」这类规范名；最终提交一段故事而非提纲。

## 边界

这是开发期观察工具，不是玩家可见功能；不自动在游戏结束时触发；不把故事写回数据库；不展开归档，除非显式要求；不做「故事是否优秀」的自动评分；不参与任何状态推进或结算。

测试用脚本化 fake LLM 走完整工具链，断言不改变 game version、公共消息与 memory。

→ 参见：[开发期 Agent 工作流](debug-workflow.md)、→ 参见：[Actor 行动与记忆](actor-actions-memory.md)

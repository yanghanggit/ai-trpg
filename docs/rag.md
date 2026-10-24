# 公共知识检索

RAG 是角色的“向世界求证”渠道，不是第二套记忆。它只承载公共知识：建筑、地理、历史、瘟疫、习俗等任何进入该世界的人都可能观察或听说的事实。角色的身世、秘密、关系、当前状态与未公开剧情仍只存在于 actor profile 与私有 memory，不能通过检索获得。

## 信息边界

知识库不得包含角色名、钥匙归属、怪物弱点、沉睡/追杀规则、当前场景状态、物品位置或任何需要特定身份才能知道的内容。生成知识时先问：一个刚进入此地的陌生人，是否可能通过观察、询问或公开记载知道这件事？答案为否，就不应入库。

`apps/server/test/seed-world.test.ts` 对演示知识库做边界检查：不得出现 actor 全名，也不得出现“钥匙”“秘密”“弱点”“沉睡”“追杀”等泄漏词。新增知识条目必须继续满足这条约束。

公共知识不等于亲眼所见。检索结果只提供文本参考资料，角色仍应结合当前场景、外观与自己的 memory 判断，不能把知识库内容当成刚刚发生的现场事实。

## 存储与向量

向量表是 `vector_documents`，由 PostgreSQL 的 pgvector 扩展提供 `vector(384)` 列。每行保存 `collection`、正文、内容 hash、来源、类型、元数据、向量与 embedding 模型名。`collection` 使用内容作用域 `world:<世界名>:<内容版本>`，同世界的同版本可复用，内容升级后不会与旧向量混用。

同一 `collection` 下按 `content_hash` 唯一，重复导入是覆盖而不是追加。检索只匹配当前 `collection` 与当前 `embedding_model`，避免换模型后新旧向量混排。向量使用余弦距离，返回 `1 - distance` 作为相似度；默认只取 topK，不强制阈值。

当前 embedding 在 Node 内通过 Transformers.js 运行 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`，输出 384 维。模型懒加载，首次运行会下载到 `apps/server/.cache/transformers/`，该目录不进入版本库。单元测试与数据库集成测试使用确定性 provider，不加载真实模型；真实语义测试单独运行。

## 写入与检索

`pnpm rag ingest --seed <name>` 从内容注册表读取知识并写入对应 world collection；`pnpm rag search --seed <name> --query "..."` 或 `pnpm rag search --collection <name> --query "..."` 执行真实中文语义检索；`pnpm rag check --seed <name>` 或 `pnpm rag check --collection <name>` 查看 collection 行数；`pnpm rag delete --collection <name> --yes` 清空一个 collection。`pnpm rag:smoke` 在测试库中完成“建表 → 写入 → 真实检索 → 清理”的端到端验证，并从内容注册表取样本，不写死故事名。

写入流程是：展开分类知识 → 生成 embedding → 在一个短事务内 upsert。检索流程是：query embedding → pgvector 余弦排序 → 返回正文、来源、分类与相似度。embedding 计算在数据库事务之外完成。

## Actor 工具

`query` 对所有 actor 开放：只要走 NPC tool loop，就能在 plan 中看到这个只读工具；玩家入口不经过 tool loop，因此玩家角色不使用它。没有按角色的白名单。

该工具是只读、非终止工具，可多次调用，不占 `MAX_ACTIONS_PER_TURN`。它只返回当前世界 collection 的公共知识，不返回 actor profile、私有 memory、stats、物品或场景实时状态。工具描述与返回文本都强调“公共知识不等于亲眼所见”。

工具本身不需要按角色声明：`query` 不是动作，不写进 `actions`，所有 actor 都有。要让某个世界真的能检索到内容，仍需为该世界执行 `pnpm rag ingest --seed <name>`，并确保 collection 与游戏内容版本一致；没有入库时 `query` 只会返回“未检索到相关信息”。

## 尚未包含

知识库与剧本 1:1 绑定：每个剧本在同目录带一个 `<剧本>.knowledge.ts`，collection 仍由剧本的 `worldName` + `contentVersion` 拼成（如 `world:枯钟修道院:dark-fantasy.v11`），所以换剧本不会串库。跨剧本通用的只有战役文本（`campaign.ts` 的 `campaignSetting` / `systemRules`），它不进知识库。

当前不做正文自动分块、混合检索、rerank、知识库 HTTP API 或建局时自动 ingest。知识条目由 seed 直接提供，默认是短事实；长文档分块与增量重建留到内容规模需要时再加。

→ 参见：[数据库](database.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[本地开发](dev-setup.md)

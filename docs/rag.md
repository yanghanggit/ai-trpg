# 公共知识检索

RAG 是角色的“向世界求证”渠道，不是第二套记忆。它只承载公共知识：建筑、地理、历史、瘟疫、习俗等任何进入该世界的人都可能观察或听说的事实。角色的身世、秘密、关系、当前状态与未公开剧情仍只存在于 actor profile 与私有 memory，不能通过检索获得。

## 信息边界

知识库不得包含角色名、钥匙归属、怪物弱点、沉睡/追杀规则、当前场景状态、物品位置或任何需要特定身份才能知道的内容。环境描写（气味、颜色、磨损、堆放物）与场景内可移动的物品同样不得入库：它们由 stage 的 `profile` / `environment` 与 `stage_items` 表达，是运行时状态，而知识是长期稳定、不因玩家行为改变的事实。生成知识时先问两个问题：一个刚进入此地的陌生人，是否可能通过观察、询问或公开记载知道这件事？这件事在他改变现场之后是否仍然成立？任一答案为否，就不应入库。

`apps/server/test/seed-world.test.ts` 对演示知识库做边界检查：不得出现 actor 全名，也不得出现“钥匙”“秘密”“弱点”“沉睡”“追杀”等泄漏词。新增知识条目必须继续满足这条约束。

公共知识不等于亲眼所见。检索结果只提供文本参考资料，角色仍应结合当前场景、外观与自己的 memory 判断，不能把知识库内容当成刚刚发生的现场事实。

## 存储与向量

向量表是 `vector_documents`，由 PostgreSQL 的 pgvector 扩展提供 `vector(384)` 列。每行保存 `collection`、正文、内容 hash、来源、类型、元数据、向量与 embedding 模型名。`collection` 的作用域是 `world:<contentKey>:<内容版本>`（`contentKey` 是剧本稳定标识，不是展示名），元数据里带 `category` 供渲染时标注分类。

同一 `collection` 下按 `content_hash` 唯一，所以相同内容重复导入是覆盖、不会重复；改过的文案是新 hash、旧 hash 变成孤儿行，由 seed 入库的同步语义清掉（见「作用域与同步」）。检索只匹配当前 `collection` 与当前 `embedding_model`，避免换模型后新旧向量混排。向量使用余弦距离，返回 `1 - distance` 作为相似度；默认只取 topK，不强制阈值。

当前 embedding 在 Node 内通过 Transformers.js 运行 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`，输出 384 维。模型懒加载，首次运行会下载到 `apps/server/.cache/transformers/`，该目录不进入版本库。单元测试与数据库集成测试使用确定性 provider，不加载真实模型；真实语义测试单独运行。

## 写入与检索

`pnpm rag ingest --seed <name>` 从内容注册表读取知识并同步到对应 collection；`pnpm rag search --seed <name> --query "..."` 或 `pnpm rag search --collection <name> --query "..."` 执行真实中文语义检索；`pnpm rag check --seed <name>` 把库内容与 seed 对账（`missing` / `orphan` / `staleModel` / `inSync`），只给 `--collection` 时退化为行数统计；`pnpm rag delete --collection <name> --yes` 清空一个 collection。`pnpm rag:smoke` 在测试库中完成“建表 → 写入 → 真实检索 → 清理”的端到端验证，并从内容注册表取样本，不写死故事名。

写入流程是：展开分类知识 → 生成 embedding → 在一个短事务内 upsert，并在同一个事务里删掉本批之外的行。检索流程是：query embedding → pgvector 余弦排序 → 返回正文、来源、分类与相似度。embedding 计算在数据库事务之外完成。

## Actor 工具

`query` 对所有 actor 开放：只要走 NPC tool loop，就能在 plan 中看到这个只读工具；玩家入口不经过 tool loop，因此玩家角色不使用它。没有按角色的白名单。

该工具是只读、非终止工具，可多次调用，不占 `MAX_ACTIONS_PER_TURN`。它只返回当前世界 collection 的公共知识，不返回 actor profile、私有 memory、stats、物品或场景实时状态。工具描述与返回文本都强调“公共知识不等于亲眼所见”。

参数是 `keywords` 而不是整句提问：`{ "keywords": "枯钟 得名" }`。当前 embedding 是句向量的 mean pooling，**没有 IDF**，整句里的高频词（如“修道院”出现在 14 条中的 8 条）会把查询拖向所有含它的条目，稀有词反而拿不到额外权重。评测集上关键词形态的 recall@1 是 1.0，整句形态是 0.786（见下节），所以提示词直接引导模型给名词短语。

返回文本按 `metadata.category` 加了分类标签（如 `1.（地窖）地窖原本是……`），并列不显示相似度：相似度只是余弦距离，模型很容易读成置信度。世界没有入库时返回“这个世界没有可检索的公共知识”，与“确实没有这条知识”区分开。

工具本身不需要按角色声明：`query` 不是动作，不写进 `actions`，所有 actor 都有。要让某个剧本真的能检索到内容，仍需执行 `pnpm rag ingest --seed <name>`；没有入库时 `query` 不会凭空编出内容。

## 作用域与同步

知识库与剧本 1:1 绑定：每个剧本在同目录带一个 `<剧本>.knowledge.ts`，collection 由剧本的 `contentKey` + `contentVersion` 拼成（如 `world:bell-monastery:dark-fantasy.v12`），所以换剧本不会串库。`contentKey` 是剧本的稳定标识（`World.contentKey`，建局时写进 `worlds.content_key`），**不是展示名**：改 `worldName` 不会让知识库变成孤儿，两个同名剧本也不会串库。跨剧本通用的只有战役文本（`campaign.ts` 的 `campaignSetting` / `systemRules`），它不进知识库。

入库是**同步**而不是追加：`indexKnowledgeBase` 会删除本批之外的旧行。所以改文案、删条目只要重跑 `pnpm rag ingest --seed <name>` 就会同步干净，不需要再 bump `contentVersion`；`contentVersion` 只用于“整体换一版内容、希望旧向量彻底作废”的场合（换 collection 名等于换库）。换了 embedding 模型时，同 hash 的行会在 upsert 中被改写成新向量。

## 尚未包含

当前不做正文自动分块、混合检索、rerank、知识库 HTTP API 或建局时自动 ingest。知识条目由 seed 直接提供，默认是短事实；长文档分块与增量重建留到内容规模需要时再加。

## 检索评测

`pnpm rag:eval` 遍历已注册的评测集，对每个剧本算 recall@1/3/5 与 MRR@5，用来判断检索改动的收益，而不是凭个别 case 的感觉。每个 case 有 `question`（整句提问）、`keywords`（关键词）与 `mixed`（整句 + 关键词）三种写法，三个变体各跑一遍同一批查询。

评测数据**跟剧本走**，不写在脚本里：`seeds/<战役>/<剧本>.eval.ts` 导出该剧本的 `RagEvalSet`（`positive` / `negative` / 可选 `thresholds`），在 `seeds/eval.ts` 的 `RAG_EVAL_SETS` 里按剧本名注册。`scripts/rag-eval.ts` 只是 runner，默认遍历全部条目。

```bash
pnpm rag:eval                  # 遍历全部已注册评测集
pnpm rag:eval --seed dark-fantasy
pnpm rag:eval --reindex        # 先按当前 seed 同步 collection
pnpm rag:eval --database TEST_DATABASE_URL --top-k 10
pnpm rag:eval --check          # 门槛校验，失败时非零退出
```

两条自检在跑分之前执行，失败直接报错退出：

- **用例不腐烂**：每个 `expect` 必须仍能在该剧本知识库里找到，否则说明文案改了而用例没改；
- **覆盖度**：每条知识至少被一个正例命中。新增知识条目而不补用例，会在这里失败——这是“14 条知识 ↔ 14 条用例”从约定变成机制的地方。

`--check` 额外做两件事：低于 MRR 门槛（默认 `question` 0.8 / `keywords` 0.9 / `mixed` 0.9，可按剧本覆盖）判失败；`CONTENT_SEEDS` 里注册了剧本但 `RAG_EVAL_SETS` 没给评测集，也判失败——新剧本不能悄悄跳过评测。

负例（知识库答不出的问题）不进 MRR，用来做两件事：量“没有答案时检索有多自信”，并标定相似度下限。

不建议把 `--check` 塞进 `pnpm verify`：它需要可用的 `DATABASE_URL` 与已下载的 embedding 模型，属于内容质量的软指标；CI 里单独跑 `pnpm rag:eval --check` 即可，退出码已经可以直接当门禁。

当前基线（`paraphrase-multilingual-MiniLM-L12-v2`、topK 5、14 条知识）：

| 变体 | recall@1 | recall@3 | recall@5 | MRR@5 |
| --- | --- | --- | --- | --- |
| `question`（整句） | 0.786 | 0.857 | 0.929 | 0.836 |
| `keywords` | 1.0 | 1.0 | 1.0 | 1.0 |
| `mixed` | 0.929 | 1.0 | 1.0 | 0.964 |

`mixed` 说明模型即使只说对一半（整句 + 关键词）也明显好于纯整句，所以提示词引导关键词是这个规模下性价比最高的一步。

两个基于这套评测得出的结论（都记在这里，避免重复尝试）：

- **不设相似度阈值**：正例命中的最低相似度是 0.373，负例最高是 0.607，两者重叠。任何阈值都会先砍掉正常命中，再去砍噪声，所以 `query` 不传 `minSimilarity`；要降噪只能改检索本身，不能调阈值。
- **不换 embedding 模型**：`Xenova/multilingual-e5-small`（384 维、加 `query:` / `passage:` 前缀）在 q8 下 `question` MRR 0.821 / `keywords` 0.929，均低于基线的 0.836 / 1.0。关键词形态已经是 1.0，没有提升空间，换模型只是换一份风险。

要收紧“高频词淹没稀有词”，下一步是给检索加词法通道（中文 bigram 切分 + `ts_rank`）并与向量结果做 RRF 融合；触发条件是知识库超过约 50 条或评测出现漏检，届时这套评测就是验收标准。

→ 参见：[数据库](database.md) → 参见：[Actor 行动与记忆](actor-actions-memory.md) → 参见：[本地开发](dev-setup.md)

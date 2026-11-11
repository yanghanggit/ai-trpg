# 世界知识检索

RAG 是角色的「向世界求证」渠道，不是第二套记忆。它只承载世界层面的固定事实：一部分是常识，任何进入该世界的人都可能知道；另一部分需要出身、训练或身份带来的访问标签。角色的身世、秘密、关系、当前状态与未公开剧情仍只存在于 actor profile 与私有 memory。

## 信息边界

知识库不得包含角色名、道具归属、角色弱点、行为规则、当前舞台状态或道具位置，也不承载只属于某个角色的秘密与私人记忆。受限知识可以入库：门槛表达的是读得懂它所需的训练或出身，不是剧情秘密。环境描写与舞台内可移动的道具也不入库：它们由 stage 的 environment 与 `stage_items` 表达，是运行时状态。

生成知识时先问：一个具备这条门槛的人，能否通过观察、询问或公开记载知道这件事？陌生人若答不上，就给条目写访问标签；任何活人都不该知道的秘密，则不属于知识库。边界由内容契约测试守卫：知识库不得出现角色全名或角色秘密类泄漏词，文档门槛必须至少有一个 actor 持有。检索结果只是参考资料，角色仍要结合当前舞台、外观与 memory 判断，不能当成刚刚发生的现场事实。

## 存储与向量

`vector_documents` 由 pgvector 提供向量列，每行保存正文、内容 hash、来源、类型、访问标签、元数据与 embedding 模型名。`access` 为空表示常识；非空时任一标签命中即可读。`collection` 作用域仍是 `world:<contentKey>:<内容版本>`，`contentKey` 是剧本稳定标识而非展示名；知识分层不拆 collection。

同一 collection 下按 `content_hash` 唯一，重复导入是覆盖；改过的文案是新 hash，旧 hash 成为孤儿行，由同步入库清掉。检索只匹配当前 collection 与当前模型，避免换模型后新旧向量混排。相似度是 `1 - 余弦距离`，默认只取 topK，不设阈值。

embedding 在 Node 内通过 Transformers.js 跑本地模型（模型与精度见 `.env.example`），懒加载、首次运行下载到 `apps/server/.cache/transformers/`（不入库）。单元与数据库测试使用确定性 provider，不加载真实模型。

## 写入与检索

`pnpm rag ingest` 从内容注册表读取知识并同步到对应 collection，`rag search` 执行真实语义检索，`rag check` 对账 `missing` / `orphan` / `accessDrift` / `staleModel` / `inSync`，`rag delete` 清空一个 collection。写入流程是展开分类知识 → 计算 embedding → 在短事务内 upsert 并删除本批之外的行；检索流程是 query embedding → 门槛过滤 → 余弦排序 → 返回正文、来源、分类与相似度。`rag search` 默认是管理端全量并打印生效的访问标签；`--as <actorKey>` 或 `--access` 模拟某个角色或标签集合。embedding 计算都在事务外完成。

入库是同步而非追加：改文案、删条目只需重跑 ingest，不必 bump 版本；版本只用于「整体换一版、旧向量彻底作废」的场合。换 embedding 模型时，同 hash 的行会在 upsert 中改写成新向量。知识随内容包定义，内置内容由 `<剧本>.knowledge.ts` 提供，外部内容用 `--file` 指定同形状 JSON；跨剧本通用的只有战役文本，不进知识库。

## Actor 工具

`query` 对所有 actor 开放：走 NPC tool loop 就能在 plan 中看到它，玩家入口不经过 loop，因此玩家角色不使用。它只读、非终止、可多次调用，不占动作额度，也不写进 `actions`。

它只返回当前 actor 有资格读到的世界知识，不返回 profile、私有 memory、stats、道具或实时舞台状态；访问标签从回合状态里的 actor 取，不接受模型参数。返回文本与 actor 的回合任务都强调「世界记载不等于亲眼所见」。参数是 `keywords` 而不是整句：当前 embedding 是句向量 mean pooling、没有 IDF，整句里的高频词会把查询拖向通用条目。返回按 `category` 加分类标签，不显示相似度——余弦值容易被模型读成置信度。世界一条知识都没有时返回「这个世界没有可检索的知识」；低权限 actor 查不到受限事实时，返回与「没有这条」相同的文本，不暴露门槛存在。

## 检索评测

`pnpm rag:eval` 遍历已注册评测集，对每个剧本算 recall@1/3/5 与 MRR@5；每个 case 有 `question`、`keywords`、`mixed` 三种写法，各跑一遍。评测数据跟剧本走：`seeds/<战役>/<剧本>.eval.ts` 导出 `RagEvalSet` 并在 `seeds/eval.ts` 注册；`scripts/rag-eval.ts` 只是 runner，`--check` 做门槛校验、失败非零退出。

跑分前先做三条自检，失败直接退出：每个 `expect` 必须仍能在知识库里找到（防止文案改了用例没改）；每条知识至少被一个正例命中，且该正例的受众必须读得到它（防止受限知识没有对应视角的用例）；每个正例的受众也必须读得到它期待的条目。用例按受众声明检索门槛，缺省是常识视角。`--check` 另外检查每个变体的 MRR 门槛（默认 `question` 0.8 / `keywords` 0.9 / `mixed` 0.9，可按剧本覆盖），以及「注册了剧本却没有评测集」的情况。负例不进 MRR，用来量无答案时的检索自信并标定相似度下限。

不适合把 `--check` 塞进 `pnpm verify`：它需要 `DATABASE_URL` 与已下载的模型，属于内容质量软指标，CI 单独跑即可。

基线不抄数字：以 `pnpm rag:eval --check` 的当次输出为准，门槛就是验收线。

两个已得出的结论，记在这里避免重复尝试：

- **不设相似度阈值**：正例与负例的相似度分布重叠，任何阈值都会先砍掉正常命中。要降噪只能改检索本身。
- **暂不换 embedding 模型**：已试过 `multilingual-e5-small`，关键词形态没有更好；知识规模变化后若要再动，用本评测重新验证，不凭个别 case 判断。

要收紧「高频词淹没稀有词」，下一步是给检索加词法通道（中文 bigram 切分 + `ts_rank`）与向量结果做 RRF 融合；触发条件是知识库超过约 50 条或评测出现漏检，届时这套评测就是验收标准。

## 尚未包含

正文自动分块、混合检索、rerank、知识库 HTTP API、建局时自动 ingest，以及 per-actor 私有知识库。知识条目由 seed 直接提供，默认是短事实；长文档分块与增量重建留到内容规模需要时再加。

→ 参见：[数据库](database.md)、[Actor 行动与记忆](actor-actions-memory.md)

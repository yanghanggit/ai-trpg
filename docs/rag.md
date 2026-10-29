# 公共知识检索

RAG 是角色的「向世界求证」渠道，不是第二套记忆。它只承载公共知识：任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实。角色的身世、秘密、关系、当前状态与未公开剧情仍只存在于 actor profile 与私有 memory。

## 信息边界

知识库不得包含角色名、物品归属、角色弱点、行为规则、当前场景状态、物品位置或任何需要特定身份才能知道的内容。环境描写与场景内可移动的物品也不入库：它们由 stage 的 environment 与 `stage_items` 表达，是运行时状态。

生成知识时先问：一个刚进入此地的陌生人，能否通过观察、询问或公开记载知道这件事？他改变现场后这件事是否仍然成立？任一答案为否，就不入库。边界由 `apps/server/test/seed-world.test.ts` 守卫，演示知识库不得出现 actor 全名或角色秘密类泄漏词。检索结果只是参考资料，角色仍要结合当前场景、外观与 memory 判断，不能当成刚刚发生的现场事实。

## 存储与向量

`vector_documents` 由 pgvector 提供向量列，每行保存正文、内容 hash、来源、类型、元数据与 embedding 模型名。`collection` 作用域是 `world:<contentKey>:<内容版本>`，`contentKey` 是剧本稳定标识而非展示名。

同一 collection 下按 `content_hash` 唯一，重复导入是覆盖；改过的文案是新 hash，旧 hash 成为孤儿行，由同步入库清掉。检索只匹配当前 collection 与当前模型，避免换模型后新旧向量混排。相似度是 `1 - 余弦距离`，默认只取 topK，不设阈值。

embedding 在 Node 内通过 Transformers.js 跑本地模型（模型与精度见 `.env.example`），懒加载、首次运行下载到 `apps/server/.cache/transformers/`（不入库）。单元与数据库测试使用确定性 provider，不加载真实模型。

## 写入与检索

`pnpm rag ingest` 从内容注册表读取知识并同步到对应 collection，`rag search` 执行真实语义检索，`rag check` 对账 `missing` / `orphan` / `staleModel` / `inSync`，`rag delete` 清空一个 collection。写入流程是展开分类知识 → 计算 embedding → 在短事务内 upsert 并删除本批之外的行；检索流程是 query embedding → 余弦排序 → 返回正文、来源、分类与相似度。embedding 计算都在事务外完成。

入库是同步而非追加：改文案、删条目只需重跑 ingest，不必 bump 版本；版本只用于「整体换一版、旧向量彻底作废」的场合。换 embedding 模型时，同 hash 的行会在 upsert 中改写成新向量。知识随内容包定义，内置内容由 `<剧本>.knowledge.ts` 提供，外部内容用 `--file` 指定同形状 JSON；跨剧本通用的只有战役文本，不进知识库。

## Actor 工具

`query` 对所有 actor 开放：走 NPC tool loop 就能在 plan 中看到它，玩家入口不经过 loop，因此玩家角色不使用。它只读、非终止、可多次调用，不占动作额度，也不写进 `actions`。

它只返回当前世界 collection 的公共知识，不返回 profile、私有 memory、stats、物品或实时场景状态；工具描述与返回文本都强调「公共知识不等于亲眼所见」。参数是 `keywords` 而不是整句：当前 embedding 是句向量 mean pooling、没有 IDF，整句里的高频词会把查询拖向通用条目。返回按 `category` 加分类标签，不显示相似度——余弦值容易被模型读成置信度。世界未入库时返回「这个世界没有可检索的公共知识」，与「确实没有这条知识」区分。

## 检索评测

`pnpm rag:eval` 遍历已注册评测集，对每个剧本算 recall@1/3/5 与 MRR@5；每个 case 有 `question`、`keywords`、`mixed` 三种写法，各跑一遍。评测数据跟剧本走：`seeds/<战役>/<剧本>.eval.ts` 导出 `RagEvalSet` 并在 `seeds/eval.ts` 注册；`scripts/rag-eval.ts` 只是 runner，`--check` 做门槛校验、失败非零退出。

跑分前先做两条自检，失败直接退出：每个 `expect` 必须仍能在知识库里找到（防止文案改了用例没改）；每条知识至少被一个正例命中（防止新增知识不补用例）。`--check` 另外检查每个变体的 MRR 门槛（默认 `question` 0.8 / `keywords` 0.9 / `mixed` 0.9，可按剧本覆盖），以及「注册了剧本却没有评测集」的情况。负例不进 MRR，用来量无答案时的检索自信并标定相似度下限。

不适合把 `--check` 塞进 `pnpm verify`：它需要 `DATABASE_URL` 与已下载的模型，属于内容质量软指标，CI 单独跑即可。

当前基线（15 条知识、topK 5）：

| 变体 | recall@1 | recall@3 | recall@5 | MRR@5 |
| --- | --- | --- | --- | --- |
| `question` | 0.733 | 0.867 | 0.933 | 0.813 |
| `keywords` | 0.867 | 1.0 | 1.0 | 0.933 |
| `mixed` | 0.8 | 1.0 | 1.0 | 0.889 |

`mixed` 的 MRR 略低于 0.9 门槛，`--check` 当前会失败；这是内容扩到 15 条后的已知回归，应先修检索或用例，不靠放宽门槛解决。

两个已得出的结论，记在这里避免重复尝试：

- **不设相似度阈值**：正例最低相似度 0.385，负例最高 0.6，两者重叠，任何阈值都会先砍掉正常命中。要降噪只能改检索本身。
- **暂不换 embedding 模型**：已试过 `multilingual-e5-small`，关键词形态没有更好；知识规模变化后若要再动，用本评测重新验证，不凭个别 case 判断。

要收紧「高频词淹没稀有词」，下一步是给检索加词法通道（中文 bigram 切分 + `ts_rank`）与向量结果做 RRF 融合；触发条件是知识库超过约 50 条或评测出现漏检，届时这套评测就是验收标准。

## 尚未包含

正文自动分块、混合检索、rerank、知识库 HTTP API、建局时自动 ingest。知识条目由 seed 直接提供，默认是短事实；长文档分块与增量重建留到内容规模需要时再加。

→ 参见：[数据库](database.md)、[Actor 行动与记忆](actor-actions-memory.md)

/** 知识库条目的附加信息；只放可 JSON 序列化的标量。 */
export type RagMetadata = {
  [key: string]: string | number | boolean | null;
};

export type EmbeddingProvider = {
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
};

/** 一条待入库的公共知识文档。 */
export type RagDocumentInput = {
  content: string;
  title?: string;
  source?: string;
  docType?: string;
  metadata?: RagMetadata;
};

/** 按分类组织的知识库；key 是分类名，value 是该分类下的独立事实条目。 */
export type KnowledgeBase = Record<string, readonly string[]>;

export type RagSearchOptions = {
  collection: string;
  query: string;
  topK?: number;
  /** 可选余弦相似度下限；默认不过滤。 */
  minSimilarity?: number;
  docType?: string;
};

export type RagSearchResult = {
  id: string;
  content: string;
  title: string | null;
  source: string | null;
  docType: string | null;
  metadata: RagMetadata;
  similarity: number;
};

export type RagIndexResult = {
  collection: string;
  written: number;
  /** 同步时删掉的旧行数量（改过的文案、删掉的条目）。 */
  removed: number;
};

export type IndexDocumentsOptions = {
  /**
   * 把 collection 同步成这一批文档：删除本批之外的旧行（改过的文案、删掉的条目）。
   * seed 入库走这个语义，避免“删掉的知识仍被检索到”。
   */
  pruneMissing?: boolean;
};

/** 检索评测变体：整句提问 / 关键词 / 整句 + 关键词。 */
export type RagEvalVariant = "question" | "keywords" | "mixed";

/** 一个剧本的检索评测集，与知识库同目录维护。 */
export type RagEvalSet = {
  /** 正例：有答案的问题；`expect` 是目标条目的唯一片段。 */
  positive: readonly { question: string; keywords: string; expect: string }[];
  /** 负例：知识库答不出的问题，用来量噪声与标定相似度下限。 */
  negative: readonly { question: string; keywords: string }[];
  /** 本剧本的 MRR 门槛，缺省项用全局默认。 */
  thresholds?: Partial<Record<RagEvalVariant, number>>;
};

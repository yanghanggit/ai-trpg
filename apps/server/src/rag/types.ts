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

/** 知识访问标签：任一命中即可读；空表示人人可知。 */
export type KnowledgeAccess = readonly string[];

/** 一条待入库的知识文档。 */
export type RagDocumentInput = {
  content: string;
  /** 读取该条所需标签；空 = 常识。 */
  access?: KnowledgeAccess;
  title?: string;
  source?: string;
  docType?: string;
  metadata?: RagMetadata;
};

/** 作者写的知识条目：字符串 = 无门槛；对象形式才需要写门槛。 */
export type KnowledgeEntry =
  | string
  | {
      content: string;
      access?: KnowledgeAccess;
    };

/** 按分类组织的知识库；key 是分类名，value 是该分类下的独立事实条目。 */
export type KnowledgeBase = Record<string, readonly KnowledgeEntry[]>;

/** 展开后的知识事实：检索、评测与对账只消费这个形状。 */
export type KnowledgeFact = {
  category: string;
  content: string;
  access: KnowledgeAccess;
};

export type RagSearchOptions = {
  collection: string;
  query: string;
  topK?: number;
  /** 可选余弦相似度下限；默认不过滤。 */
  minSimilarity?: number;
  docType?: string;
  /**
   * 访问门槛：缺省不过滤（管理端）；空数组只看无门槛条目；
   * 非空时返回无门槛条目与任一标签命中的条目。
   */
  access?: KnowledgeAccess;
};

export type RagSearchResult = {
  id: string;
  content: string;
  /** 该条的阅读门槛；空数组 = 常识。 */
  access: KnowledgeAccess;
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
  positive: readonly {
    question: string;
    keywords: string;
    expect: string;
    /** 这条用例按谁的见识检索；缺省 = 常识视角。 */
    access?: KnowledgeAccess;
  }[];
  /** 负例：知识库答不出的问题，用来量噪声与标定相似度下限。 */
  negative: readonly {
    question: string;
    keywords: string;
    access?: KnowledgeAccess;
  }[];
  /** 本剧本的 MRR 门槛，缺省项用全局默认。 */
  thresholds?: Partial<Record<RagEvalVariant, number>>;
};

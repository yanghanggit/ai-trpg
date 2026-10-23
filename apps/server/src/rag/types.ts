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
};

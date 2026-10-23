/** 当前 embedding 模型的固定输出维度；数据库列与 provider 必须一致。 */
export const EMBEDDING_DIMENSIONS = 384;

/** 多语言句子嵌入模型；与中文知识库检索使用同一套向量空间。 */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

export type EmbeddingDtype = "fp32" | "fp16" | "q8" | "q4";

/** 默认使用 8bit 量化模型，减少下载体积与内存占用。 */
export const DEFAULT_EMBEDDING_DTYPE: EmbeddingDtype = "q8";

export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

export const DEFAULT_RAG_TOP_K = 5;

export const MAX_RAG_TOP_K = 50;

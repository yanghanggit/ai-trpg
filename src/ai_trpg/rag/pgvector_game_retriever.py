"""
PostgreSQL + pgvector 文档检索器实现

本模块提供基于 PostgreSQL + pgvector 的文档检索器实现。

PGVectorGameDocumentRetriever 使用 PostgreSQL + pgvector 向量数据库
和 SentenceTransformer 嵌入模型进行真实的文档检索。
"""

from typing import List
from loguru import logger
from ..deepseek import DocumentRetriever
from .pgvector_knowledge_retrieval import pgvector_search_similar_documents
from ..embedding_model import multilingual_model


############################################################################################################
# 游戏文档检索器实现（使用 PostgreSQL + pgvector 和 SentenceTransformer）
############################################################################################################
class PGVectorGameDocumentRetriever(DocumentRetriever):
    """
    基于 PostgreSQL + pgvector 的游戏文档检索器实现

    使用 PostgreSQL + pgvector 向量数据库和 SentenceTransformer 嵌入模型进行真实的文档检索。
    与 ChromaGameDocumentRetriever 功能相同，但使用 PostgreSQL 作为后端存储。

    该检索器从 PostgreSQL 数据库中检索与用户查询最相关的游戏知识文档。
    """

    def retrieve_documents(
        self, user_query: str, top_k: int, min_similarity: float
    ) -> tuple[List[str], List[float]]:
        """
        从 PostgreSQL + pgvector 检索与查询相关的文档

        使用语义搜索在向量数据库中查找最相关的文档。

        Args:
            user_query: 用户查询文本
            top_k: 返回的最大文档数量
            min_similarity: 最小相似度阈值（0.0-1.0）

        Returns:
            (检索文档列表, 相似度分数列表)
        """

        assert top_k > 0, "top_k 必须大于0"
        assert 0.0 <= min_similarity <= 1.0, "min_similarity 必须在0.0到1.0之间"

        logger.info("🎮 [PGVECTOR] 使用 PGVectorGameDocumentRetriever 进行真实检索")
        logger.info(f"🎮 [PGVECTOR] 查询: {user_query}")
        logger.info(
            f"🎮 [PGVECTOR] 参数: top_k={top_k}, min_similarity={min_similarity}"
        )

        try:
            # 使用 pgvector_search_similar_documents 进行语义搜索
            documents, scores = pgvector_search_similar_documents(
                query=user_query,
                embedding_model=multilingual_model,
                top_k=top_k,
                similarity_threshold=min_similarity,
            )

            # 过滤低于相似度阈值的文档
            filtered_docs = []
            filtered_scores = []
            for doc, score in zip(documents, scores):
                if score >= min_similarity:
                    filtered_docs.append(doc)
                    filtered_scores.append(score)
                else:
                    logger.debug(
                        f"🎮 [PGVECTOR] 过滤低相似度文档: {score:.3f} < {min_similarity}"
                    )

            # 日志输出检索结果
            if filtered_docs:
                logger.success(
                    f"✅ [PGVECTOR] 找到 {len(filtered_docs)} 个相关文档（过滤后）"
                )
                for i, (doc, score) in enumerate(
                    zip(filtered_docs, filtered_scores), 1
                ):
                    logger.info(f"  [✨{i}] 相似度: {score:.3f}")
                    logger.info(f"      内容: {doc[:80]}...")
            else:
                logger.warning(f"⚠️ [PGVECTOR] 未找到相似度 >= {min_similarity} 的文档")

            return filtered_docs, filtered_scores

        except Exception as e:
            logger.error(f"❌ [PGVECTOR] 文档检索失败: {e}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")
            return [], []


############################################################################################################

"""
Mock 文档检索器实现

本模块提供用于测试的 Mock 文档检索器实现。

MockDocumentRetriever 返回预定义的模拟文档和相似度分数，
用于测试 RAG 工作流，无需依赖真实的向量数据库。
"""

from typing import List
from loguru import logger
from ..deepseek import DocumentRetriever
from ..chroma import get_default_collection
from .knowledge_retrieval import search_similar_documents
from ..embedding_model import get_embedding_model


############################################################################################################
# 游戏文档检索器实现（使用 ChromaDB 和 SentenceTransformer）
############################################################################################################
class GameDocumentRetriever(DocumentRetriever):
    """
    游戏文档检索器实现

    使用 ChromaDB 向量数据库和 SentenceTransformer 嵌入模型进行真实的文档检索。
    参考 setup_dev_environment.py 中的 _test_chromadb_search 实现。

    该检索器从初始化的 ChromaDB 集合中检索与用户查询最相关的游戏知识文档。
    """

    def retrieve_documents(
        self, user_query: str, top_k: int, min_similarity: float
    ) -> tuple[List[str], List[float]]:
        """
        从 ChromaDB 检索与查询相关的文档

        使用语义搜索在向量数据库中查找最相关的文档，
        参考 setup_dev_environment.py 中 _test_chromadb_search 的实现。

        Args:
            user_query: 用户查询文本
            top_k: 返回的最大文档数量
            min_similarity: 最小相似度阈值（0.0-1.0）

        Returns:
            (检索文档列表, 相似度分数列表)
        """

        assert top_k > 0, "top_k 必须大于0"
        assert 0.0 <= min_similarity <= 1.0, "min_similarity 必须在0.0到1.0之间"

        logger.info("🎮 [GAME] 使用 GameDocumentRetriever 进行真实检索")
        logger.info(f"🎮 [GAME] 查询: {user_query}")
        logger.info(f"🎮 [GAME] 参数: top_k={top_k}, min_similarity={min_similarity}")

        try:

            embedding_model = get_embedding_model()
            assert embedding_model is not None, "嵌入模型未加载成功"

            # 使用 search_similar_documents 进行语义搜索
            documents, scores = search_similar_documents(
                query=user_query,
                collection=get_default_collection(),
                embedding_model=embedding_model,
                top_k=top_k,
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
                        f"🎮 [GAME] 过滤低相似度文档: {score:.3f} < {min_similarity}"
                    )

            # 日志输出检索结果
            if filtered_docs:
                logger.success(
                    f"✅ [GAME] 找到 {len(filtered_docs)} 个相关文档（过滤后）"
                )
                for i, (doc, score) in enumerate(
                    zip(filtered_docs, filtered_scores), 1
                ):
                    logger.info(f"  [✨{i}] 相似度: {score:.3f}")
                    logger.info(f"      内容: {doc[:80]}...")
            else:
                logger.warning(f"⚠️ [GAME] 未找到相似度 >= {min_similarity} 的文档")

            return filtered_docs, filtered_scores

        except Exception as e:
            logger.error(f"❌ [GAME] 文档检索失败: {e}")
            import traceback

            logger.error(f"Traceback: {traceback.format_exc()}")
            return [], []

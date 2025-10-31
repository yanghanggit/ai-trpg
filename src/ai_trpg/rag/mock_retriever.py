"""
Mock 文档检索器实现

本模块提供用于测试的 Mock 文档检索器实现。

MockDocumentRetriever 返回预定义的模拟文档和相似度分数，
用于测试 RAG 工作流，无需依赖真实的向量数据库。
"""

from typing import List
from loguru import logger
from ..deepseek import DocumentRetriever


class MockDocumentRetriever(DocumentRetriever):
    """
    Mock 文档检索器实现

    用于测试 RAG 工作流，返回预定义的模拟文档和相似度分数。
    在真实场景中，应该使用 ChromaDBRetriever 或其他实际的检索器实现。
    """

    def retrieve_documents(
        self, user_query: str, top_k: int, min_similarity: float
    ) -> tuple[List[str], List[float]]:
        """
        返回 Mock 检索数据（用于测试 RAG 流程）

        Args:
            user_query: 用户查询文本
            top_k: 返回的最大文档数量
            min_similarity: 最小相似度阈值

        Returns:
            (检索文档列表, 相似度分数列表)
        """

        assert top_k > 0, "top_k 必须大于0"
        assert 0.0 <= min_similarity <= 1.0, "min_similarity 必须在0.0到1.0之间"

        logger.info("🎭 [MOCK] 使用 MockDocumentRetriever 模拟检索")
        logger.info(f"🎭 [MOCK] 查询: {user_query}")

        # 模拟检索到的文档（按相似度降序排列）
        mock_docs = [
            "RAG（Retrieval-Augmented Generation）是一种结合检索和生成的AI技术，通过从知识库检索相关信息来增强大语言模型的回答质量。",
            "RAG系统通常包含三个核心组件：文档检索器（使用向量数据库如ChromaDB）、上下文增强器和语言模型生成器。",
            "使用RAG技术可以让AI模型访问最新的、领域特定的知识，而无需重新训练模型，显著提升回答的准确性和时效性。",
            "向量数据库（如ChromaDB、Pinecone）在RAG系统中扮演关键角色，它们使用嵌入模型将文本转换为向量并进行语义搜索。",
            "LangGraph是一个用于构建有状态、多参与者AI应用的框架，非常适合实现复杂的RAG工作流。",
        ]

        # 模拟相似度分数（降序排列，模拟真实检索结果）
        mock_scores = [0.89, 0.76, 0.68, 0.52, 0.41]

        logger.info(f"🎭 [MOCK] 返回 {len(mock_docs)} 个模拟文档")
        for i, (doc, score) in enumerate(zip(mock_docs, mock_scores), 1):
            logger.debug(f"🎭 [MOCK] [{i}] 相似度: {score:.3f}, 内容: {doc[:50]}...")

        return mock_docs, mock_scores

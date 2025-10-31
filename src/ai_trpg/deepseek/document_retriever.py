"""
文档检索器抽象接口

本模块定义了文档检索的标准接口，所有具体的检索实现（ChromaDB、Elasticsearch等）
都应该继承 DocumentRetriever 类并实现 retrieve_documents 方法。

设计理念：
- 统一接口：提供一致的检索API，方便替换不同的检索实现
- 扩展性：支持多种检索后端（向量数据库、全文搜索、混合检索等）
- 可测试性：便于创建Mock实现进行单元测试
"""

from abc import ABC, abstractmethod
from typing import List


class DocumentRetriever(ABC):
    """
    文档检索器抽象基类

    定义了文档检索的标准接口，所有具体的检索实现（ChromaDB、Elasticsearch等）
    都应该继承此类并实现 retrieve_documents 方法。

    设计理念：
    - 统一接口：提供一致的检索API，方便替换不同的检索实现
    - 扩展性：支持多种检索后端（向量数据库、全文搜索、混合检索等）
    - 可测试性：便于创建Mock实现进行单元测试
    """

    @abstractmethod
    def retrieve_documents(
        self, user_query: str, top_k: int, min_similarity: float
    ) -> tuple[List[str], List[float]]:
        """
        检索与用户查询相关的文档

        Args:
            user_query: 用户查询文本
            top_k: 返回的最大文档数量（默认：5）
            min_similarity: 最小相似度阈值，低于此值的结果将被过滤（默认：0.0）

        Returns:
            tuple[List[str], List[float]]:
                - List[str]: 检索到的文档列表（按相似度降序排列）
                - List[float]: 对应的相似度分数列表（范围：0.0-1.0）

        Raises:
            NotImplementedError: 子类必须实现此方法

        Example:
            >>> retriever = ConcreteRetriever()
            >>> docs, scores = retriever.retrieve_documents("什么是RAG?", top_k=3)
            >>> print(f"找到 {len(docs)} 个文档")
            >>> for doc, score in zip(docs, scores):
            ...     print(f"相似度: {score:.3f} - {doc[:50]}...")
        """
        raise NotImplementedError("子类必须实现 retrieve_documents 方法")

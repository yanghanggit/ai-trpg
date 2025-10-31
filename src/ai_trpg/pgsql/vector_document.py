"""
PostgreSQL + pgvector 向量操作工具集
提供向量存储、检索、相似度搜索等功能
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from loguru import logger
from pgvector.sqlalchemy import Vector  # type: ignore
from sqlalchemy import DateTime, Index, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column
from .base import UUIDBase
from .client import SessionLocal


class VectorDocumentDB(UUIDBase):
    """向量文档存储表 - 用于RAG功能的文档向量化存储"""

    __tablename__ = "vector_documents"

    # 文档内容
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # 文档标题/摘要
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # 文档来源/路径
    source: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 文档类型/分类
    doc_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # 向量嵌入 (假设使用1536维度的向量，如OpenAI的text-embedding-ada-002)
    embedding: Mapped[Optional[List[float]]] = mapped_column(
        Vector(1536), nullable=True
    )

    # 文档大小/字符数
    content_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 元数据字段（重命名以避免与SQLAlchemy的metadata冲突）
    doc_metadata: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # JSON字符串存储额外信息

    # 创建时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 更新时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # 为向量字段创建索引以优化相似度搜索
    __table_args__ = (
        Index(
            "ix_vector_documents_embedding",
            "embedding",
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},
        ),
        Index("ix_vector_documents_doc_type", "doc_type"),
        Index("ix_vector_documents_source", "source"),
    )


##################################################################################################################
# 向量文档操作
##################################################################################################################


def save_vector_document(
    content: str,
    embedding: List[float],
    title: Optional[str] = None,
    source: Optional[str] = None,
    doc_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> VectorDocumentDB:
    """
    保存文档及其向量嵌入到数据库

    参数:
        content: 文档内容
        embedding: 向量嵌入 (1536维)
        title: 文档标题
        source: 文档来源
        doc_type: 文档类型
        metadata: 元数据字典

    返回:
        VectorDocumentDB: 保存的文档对象
    """
    db = SessionLocal()
    try:
        # 验证向量维度
        if len(embedding) != 1536:
            raise ValueError(f"向量维度必须是1536，当前维度: {len(embedding)}")

        document = VectorDocumentDB(
            content=content,
            embedding=embedding,
            title=title,
            source=source,
            doc_type=doc_type,
            content_length=len(content),
            doc_metadata=json.dumps(metadata) if metadata else None,
        )

        db.add(document)
        db.commit()
        db.refresh(document)

        logger.info(f"✅ 向量文档已保存: ID={document.id}, 内容长度={len(content)}")
        return document

    except Exception as e:
        db.rollback()
        logger.error(f"❌ 保存向量文档失败: {e}")
        raise e
    finally:
        db.close()


def search_similar_documents(
    query_embedding: List[float],
    limit: int = 10,
    doc_type_filter: Optional[str] = None,
    similarity_threshold: float = 0.3,
) -> List[Tuple[VectorDocumentDB, float]]:
    """
    基于向量相似度搜索文档

    参数:
        query_embedding: 查询向量
        limit: 返回结果数量限制
        doc_type_filter: 文档类型过滤
        similarity_threshold: 相似度阈值

    返回:
        List[Tuple[VectorDocumentDB, float]]: (文档对象, 相似度分数) 的列表
    """
    db = SessionLocal()
    try:
        if len(query_embedding) != 1536:
            raise ValueError(
                f"查询向量维度必须是1536，当前维度: {len(query_embedding)}"
            )

        # 构建SQL条件
        conditions = ["embedding IS NOT NULL"]
        # 将向量转换为PostgreSQL向量格式的字符串
        vector_str = "[" + ",".join(map(str, query_embedding)) + "]"
        params = {
            "query_vector": vector_str,
            "threshold": similarity_threshold,
            "limit": limit,
        }

        if doc_type_filter:
            conditions.append("doc_type = :doc_type_filter")
            params["doc_type_filter"] = doc_type_filter

        where_clause = " AND ".join(conditions)

        # 直接使用原生SQL进行向量搜索
        sql = f"""
            SELECT *, (1 - (embedding <=> :query_vector)) as similarity
            FROM vector_documents 
            WHERE {where_clause}
                AND (1 - (embedding <=> :query_vector)) >= :threshold
            ORDER BY embedding <=> :query_vector
            LIMIT :limit
        """

        results = db.execute(text(sql), params).fetchall()

        # 转换结果
        documents_with_scores = []
        for row in results:
            doc = db.get(VectorDocumentDB, row.id)
            if doc:
                documents_with_scores.append((doc, float(row.similarity)))

        logger.info(f"🔍 找到 {len(documents_with_scores)} 个相似文档")
        return documents_with_scores

    except Exception as e:
        logger.error(f"❌ 向量搜索失败: {e}")
        raise e
    finally:
        db.close()


##################################################################################################################
# 游戏知识向量操作
##################################################################################################################


##################################################################################################################
# 辅助工具函数
##################################################################################################################


def get_database_vector_stats() -> Dict[str, Any]:
    """
    获取数据库中向量数据的统计信息

    返回:
        Dict[str, Any]: 包含各表向量数据统计的字典
    """
    db = SessionLocal()
    try:
        stats = {}

        # 向量文档统计
        doc_count = db.query(VectorDocumentDB).count()
        doc_with_vectors = (
            db.query(VectorDocumentDB)
            .filter(VectorDocumentDB.embedding.is_not(None))
            .count()
        )
        stats["vector_documents"] = {
            "total_count": doc_count,
            "with_embeddings": doc_with_vectors,
            "without_embeddings": doc_count - doc_with_vectors,
        }

        logger.info(f"📊 向量数据库统计: {stats}")
        return stats

    except Exception as e:
        logger.error(f"❌ 获取向量统计失败: {e}")
        raise e
    finally:
        db.close()


def cleanup_empty_embeddings() -> Dict[str, int]:
    """
    清理没有向量嵌入的记录

    返回:
        Dict[str, int]: 清理的记录数统计
    """
    db = SessionLocal()
    try:
        cleanup_stats = {}

        # 清理没有嵌入的文档
        deleted_docs = (
            db.query(VectorDocumentDB)
            .filter(VectorDocumentDB.embedding.is_(None))
            .delete()
        )
        cleanup_stats["deleted_documents"] = deleted_docs

        db.commit()

        logger.info(f"🧹 清理完成: {cleanup_stats}")
        return cleanup_stats

    except Exception as e:
        db.rollback()
        logger.error(f"❌ 清理向量数据失败: {e}")
        raise e
    finally:
        db.close()

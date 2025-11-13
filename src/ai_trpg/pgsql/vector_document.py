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

    # 向量维度 (支持可配置维度: 384, 768, 1536等)
    embedding_dim: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1536, index=True
    )

    # 向量嵌入 (支持可配置维度，不再硬编码1536)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(), nullable=True)

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

    # 索引配置 (移除向量索引以支持多维度灵活性)
    # 注意: 对于小规模数据(<10000文档), 无向量索引的性能影响可忽略
    # 如需优化大规模查询, 可为特定维度添加条件索引
    # embedding_dim 索引已在字段定义中通过 index=True 创建
    __table_args__ = (
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
        embedding: 向量嵌入 (支持任意维度: 384, 768, 1536等)
        title: 文档标题
        source: 文档来源
        doc_type: 文档类型
        metadata: 元数据字典

    返回:
        VectorDocumentDB: 保存的文档对象
    """
    with SessionLocal() as db:
        try:
            # 自动检测向量维度
            embedding_dim = len(embedding)

            if embedding_dim == 0:
                raise ValueError("向量维度不能为0")

            document = VectorDocumentDB(
                content=content,
                embedding=embedding,
                embedding_dim=embedding_dim,
                title=title,
                source=source,
                doc_type=doc_type,
                content_length=len(content),
                doc_metadata=json.dumps(metadata) if metadata else None,
            )

            db.add(document)
            db.commit()
            db.refresh(document)

            logger.info(
                f"✅ 向量文档已保存: ID={document.id}, 维度={embedding_dim}, 内容长度={len(content)}"
            )
            return document

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 保存向量文档失败: {e}")
            raise e


def clear_all_vector_documents() -> bool:
    """
    清空 vector_documents 表中的所有文档

    注意：此操作不可逆，仅适用于开发环境重置或数据迁移场景

    返回:
        bool: 清空是否成功
    """
    logger.info("🗑️ [CLEAR] 开始清空 vector_documents 表...")

    with SessionLocal() as db:
        try:
            from sqlalchemy import func

            count_before = db.query(func.count(VectorDocumentDB.id)).scalar()
            logger.info(f"📊 [CLEAR] 清空前文档数量: {count_before}")

            db.query(VectorDocumentDB).delete()
            db.commit()

            count_after = db.query(func.count(VectorDocumentDB.id)).scalar()
            logger.success(
                f"✅ [CLEAR] 表数据已清空 (删除了 {count_before} 条文档，剩余 {count_after} 条)"
            )
            return True

        except Exception as e:
            logger.error(f"❌ [CLEAR] 清空表数据失败: {e}")
            db.rollback()
            return False


def search_similar_documents(
    query_embedding: List[float],
    limit: int,
    similarity_threshold: float,
    doc_type_filter: Optional[str] = None,
) -> List[Tuple[VectorDocumentDB, float]]:
    """
    基于向量相似度搜索文档

    参数:
        query_embedding: 查询向量 (支持任意维度)
        limit: 返回结果数量限制
        similarity_threshold: 相似度阈值
        doc_type_filter: 文档类型过滤

    返回:
        List[Tuple[VectorDocumentDB, float]]: (文档对象, 相似度分数) 的列表
    """
    with SessionLocal() as db:
        try:
            # 自动检测查询向量维度
            query_dim = len(query_embedding)

            if query_dim == 0:
                raise ValueError("查询向量维度不能为0")

            # 构建SQL条件
            conditions = [
                "embedding IS NOT NULL",
                f"embedding_dim = {query_dim}",  # 只搜索相同维度的文档
            ]

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

            logger.info(
                f"🔍 找到 {len(documents_with_scores)} 个相似文档 (维度={query_dim})"
            )
            return documents_with_scores

        except Exception as e:
            logger.error(f"❌ 向量搜索失败: {e}")
            raise e

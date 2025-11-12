"""
PostgreSQL + pgvector RAG操作模块

此模块提供基于 PostgreSQL + pgvector 的 RAG（检索增强生成）系统核心操作功能：
1. 初始化RAG系统 - 将知识库加载到 PostgreSQL 向量数据库
2. 语义搜索 - 基于查询文本检索相关文档

功能：
- pgvector_load_knowledge_base_to_vector_db: 初始化整个RAG系统，包括向量数据库和知识库加载
- pgvector_search_similar_documents: 执行语义搜索，返回最相关的文档和相似度分数
"""

import traceback
from typing import Any, Dict, List, Tuple
from loguru import logger
from sentence_transformers import SentenceTransformer
from sqlalchemy import func
from ..pgsql.vector_document import (
    VectorDocumentDB,
    save_vector_document,
    search_similar_documents,
)
from ..pgsql.client import SessionLocal


############################################################################################################
# 内部函数
############################################################################################################


def _prepare_documents_for_vector_storage(
    knowledge_base: Dict[str, List[str]],
    embedding_model: SentenceTransformer,
    source: str,
) -> List[Dict[str, Any]]:
    """
    准备知识库数据用于向量化和存储

    Args:
        knowledge_base: 知识库数据，格式为 {category: [documents]}
        embedding_model: SentenceTransformer 嵌入模型实例
        source: 数据来源标识

    Returns:
        List[Dict]: 准备好的文档字典列表，每个字典包含存储所需的所有字段
    """
    try:
        logger.info("🔄 [PREPARE] 开始准备知识库数据...")

        # 准备文档数据
        documents_data = []
        all_texts = []
        doc_metadata = []

        doc_id = 0
        for category, docs in knowledge_base.items():
            for doc in docs:
                all_texts.append(doc)
                doc_metadata.append(
                    {
                        "category": category,
                        "doc_id": doc_id,
                        "title": f"{category}_{doc_id}",
                    }
                )
                doc_id += 1

        logger.info(f"📊 [PREPARE] 准备向量化 {len(all_texts)} 个文档...")

        # 使用 SentenceTransformer 批量计算向量嵌入
        logger.info("🔄 [PREPARE] 计算文档向量嵌入...")
        embeddings = embedding_model.encode(all_texts, show_progress_bar=True)

        # 组装文档数据
        for i, (text, embedding, metadata) in enumerate(
            zip(all_texts, embeddings, doc_metadata)
        ):
            documents_data.append(
                {
                    "content": text,
                    "embedding": embedding.tolist(),
                    "title": metadata["title"],
                    "doc_type": metadata["category"],
                    "source": source,
                    "metadata": metadata,
                }
            )

        logger.success(f"✅ [PREPARE] 成功准备 {len(documents_data)} 个文档的嵌入数据")
        logger.info(f"📐 [PREPARE] 向量维度: {len(embeddings[0])}")

        return documents_data

    except Exception as e:
        logger.error(f"❌ [PREPARE] 准备知识库数据失败: {e}\n{traceback.format_exc()}")
        return []


############################################################################################################
# 公共函数
############################################################################################################


def pgvector_load_knowledge_base_to_vector_db(
    knowledge_base: Dict[str, List[str]],
    embedding_model: SentenceTransformer,
    source: str,
) -> bool:
    """
    初始化 PostgreSQL + pgvector RAG系统

    功能：
    1. 将知识库数据向量化并存储到 PostgreSQL
    2. 验证系统就绪状态

    Args:
        knowledge_base: 要加载的知识库数据，格式为 {category: [documents]}
        embedding_model: SentenceTransformer 嵌入模型实例
        source: 数据来源标识

    Returns:
        bool: 初始化是否成功
    """
    logger.info("🚀 [INIT] 开始初始化 PostgreSQL + pgvector RAG系统...")

    db = SessionLocal()
    try:
        # 1. 检查数据库中是否已有数据
        count = db.query(func.count(VectorDocumentDB.id)).scalar()

        if count == 0:
            logger.info("📚 [INIT] 数据库为空，开始加载知识库数据...")

            # 2. 准备知识库数据
            documents_data = _prepare_documents_for_vector_storage(
                knowledge_base, embedding_model, source
            )

            if not documents_data:
                logger.error("❌ [INIT] 知识库数据准备失败")
                return False

            # 3. 批量保存到数据库
            logger.info("💾 [INIT] 存储向量到 PostgreSQL 数据库...")
            saved_count = 0

            for doc_data in documents_data:
                try:
                    save_vector_document(
                        content=doc_data["content"],
                        embedding=doc_data["embedding"],
                        title=doc_data["title"],
                        doc_type=doc_data["doc_type"],
                        source=doc_data["source"],
                        metadata=doc_data["metadata"],
                    )
                    saved_count += 1
                except Exception as e:
                    logger.error(f"❌ [INIT] 保存文档失败: {e}")
                    continue

            logger.success(
                f"✅ [INIT] 成功加载 {saved_count}/{len(documents_data)} 个文档到向量数据库"
            )

            # 4. 验证数据加载
            final_count = db.query(func.count(VectorDocumentDB.id)).scalar()
            logger.info(f"📊 [INIT] 数据库中现有文档数量: {final_count}")

        else:
            logger.info(f"ℹ️ [INIT] 数据库中已有 {count} 条文档，跳过加载")

        logger.success("🎉 [INIT] PostgreSQL + pgvector RAG系统初始化完成！")
        return True

    except Exception as e:
        logger.error(f"❌ [INIT] 初始化过程中发生错误: {e}\n{traceback.format_exc()}")
        logger.warning("⚠️ [INIT] 系统将回退到关键词匹配模式")
        return False
    finally:
        db.close()


############################################################################################################


def pgvector_search_similar_documents(
    query: str,
    embedding_model: SentenceTransformer,
    top_k: int,
    similarity_threshold: float = 0.3,
    doc_type_filter: str | None = None,
) -> Tuple[List[str], List[float]]:
    """
    执行语义搜索

    功能：
    1. 计算查询向量
    2. 在 PostgreSQL + pgvector 中执行向量搜索
    3. 返回搜索结果

    Args:
        query: 用户查询文本
        embedding_model: SentenceTransformer 嵌入模型实例
        top_k: 返回最相似的文档数量
        similarity_threshold: 相似度阈值 (0.0-1.0)
        doc_type_filter: 文档类型过滤 (可选)

    Returns:
        tuple: (检索到的文档列表, 相似度分数列表)
    """
    try:
        logger.info(f"🔍 [PGVECTOR] 执行语义搜索: '{query}'")

        # 1. 计算查询向量
        query_embedding = embedding_model.encode([query])[0]
        query_embedding_list = query_embedding.tolist()

        logger.debug(f"📐 [PGVECTOR] 查询向量维度: {len(query_embedding_list)}")

        # 2. 在 PostgreSQL 中执行向量搜索
        results = search_similar_documents(
            query_embedding=query_embedding_list,
            limit=top_k,
            similarity_threshold=similarity_threshold,
            doc_type_filter=doc_type_filter,
        )

        # 3. 提取结果
        documents = [doc.content for doc, _ in results]
        similarity_scores = [score for _, score in results]

        logger.info(f"✅ [PGVECTOR] 搜索完成，找到 {len(documents)} 个相关文档")

        # 4. 打印搜索结果详情（用于调试）
        for i, (doc_obj, score) in enumerate(results):
            logger.debug(
                f"  📄 [{i+1}] 相似度: {score:.3f}, 类别: {doc_obj.doc_type}, 内容: {doc_obj.content[:50]}..."
            )

        return documents, similarity_scores

    except Exception as e:
        logger.error(f"❌ [PGVECTOR] 语义搜索失败: {e}\n{traceback.format_exc()}")
        return [], []


############################################################################################################

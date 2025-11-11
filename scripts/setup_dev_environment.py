import os
import sys
from typing import List


# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)
from loguru import logger
from ai_trpg.pgsql import (
    pgsql_create_database,
    pgsql_drop_database,
    pgsql_ensure_database_tables,
    postgresql_config,
)
from ai_trpg.rag.pgvector_knowledge_retrieval import (
    pgvector_load_knowledge_base_to_vector_db,
    pgvector_search_similar_documents,
)
from ai_trpg.demo import test_knowledge_base1
from ai_trpg.embedding_model import multilingual_model


#######################################################################################################
def _test_pgvector_search(test_queries: List[str]) -> None:
    """
    测试 PostgreSQL + pgvector 向量检索功能
    验证语义搜索是否能正确检索到相关文档
    """
    logger.info("🔍 开始测试 PostgreSQL 向量检索功能...")

    for query in test_queries:
        logger.info(f"📝 测试查询: '{query}'")
        documents, scores = pgvector_search_similar_documents(
            query=query,
            embedding_model=multilingual_model,
            top_k=3,
        )

        if documents:
            logger.success(f"✅ 找到 {len(documents)} 个相关文档")
            for i, (doc, score) in enumerate(zip(documents, scores), 1):
                logger.info(f"  [{i}] 相似度: {score:.3f}")
                logger.info(f"      内容: {doc[:80]}...")
        else:
            logger.warning(f"⚠️ 未找到相关文档")

        logger.info("")  # 空行分隔

    logger.success("🎉 PostgreSQL 向量检索功能测试完成")


#######################################################################################################
def _setup_pgvector() -> None:
    """
    清理现有的 PostgreSQL 向量数据，然后使用正式的知识库数据重新初始化
    包括向量数据库的设置和知识库数据的加载
    """
    try:
        # 加载知识库到 PostgreSQL (数据库已在前面重置,表是空的)
        success = pgvector_load_knowledge_base_to_vector_db(
            knowledge_base=test_knowledge_base1,
            embedding_model=multilingual_model,
        )

        if success:
            logger.success("✅ PostgreSQL 测试知识库加载成功")

            # 测试向量检索功能
            # _test_pgvector_search(test_queries_for_knowledge_base1)

        else:
            logger.error("❌ PostgreSQL 测试知识库加载失败")
            raise Exception("PostgreSQL 知识库加载失败")

    except ImportError as e:
        logger.error(f"❌ 无法导入 PostgreSQL 相关模块: {e}")
        raise
    except Exception as e:
        logger.error(f"❌ PostgreSQL 初始化过程中发生错误: {e}")
        raise


#######################################################################################################
def main() -> None:

    logger.info("🚀 开始初始化开发环境...")

    # PostgreSQL 相关操作
    try:
        logger.info("🗑️ 删除旧数据库（如果存在）...")
        pgsql_drop_database(postgresql_config.database)

        logger.info("📦 创建新数据库...")
        pgsql_create_database(postgresql_config.database)

        logger.info("📋 创建数据库表结构...")
        pgsql_ensure_database_tables()

        logger.success("✅ PostgreSQL 数据库初始化完成")

        # PostgreSQL + pgvector RAG 系统
        logger.info("🚀 初始化 PostgreSQL + pgvector RAG 系统...")
        _setup_pgvector()
        logger.success("✅ PostgreSQL + pgvector RAG 系统初始化完成")

    except Exception as e:
        logger.error(f"❌ PostgreSQL 初始化失败: {e}")

    logger.info("🎉 开发环境初始化完成")


#######################################################################################################
# Main execution
if __name__ == "__main__":
    main()

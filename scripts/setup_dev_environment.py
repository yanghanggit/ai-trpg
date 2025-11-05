import os
import sys


# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)
from loguru import logger
from ai_trpg.mongodb import (
    mongodb_clear_database,
)
from ai_trpg.pgsql import (
    pgsql_create_database,
    pgsql_drop_database,
    pgsql_ensure_database_tables,
    postgresql_config,
)
from ai_trpg.redis.client import (
    redis_flushall,
)
from ai_trpg.chroma import reset_client, get_default_collection
from ai_trpg.rag.knowledge_retrieval import (
    load_knowledge_base_to_vector_db,
    search_similar_documents,
)
from ai_trpg.demo.world1 import test_knowledge_base1
from ai_trpg.embedding_model import multilingual_model


#######################################################################################################
def _test_chromadb_search() -> None:
    """
    测试ChromaDB向量检索功能
    验证语义搜索是否能正确检索到相关文档
    """
    logger.info("🔍 开始测试向量检索功能...")

    # embedding_model = get_embedding_model()
    # assert embedding_model is not None, "嵌入模型未加载成功"

    # 测试查询列表
    test_queries = [
        "暗影裂谷在哪里？",
        "翡翠之湖有什么特点？",
        "烈焰山脉有什么资源？",
        "迷雾港口是什么样的？",
        "永恒雪原有什么？",
    ]

    for query in test_queries:
        logger.info(f"📝 测试查询: '{query}'")
        documents, scores = search_similar_documents(
            query=query,
            collection=get_default_collection(),
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

    logger.success("🎉 向量检索功能测试完成")


#######################################################################################################
def _setup_chromadb() -> None:
    """
    清理现有的ChromaDB数据，然后使用正式的知识库数据重新初始化.
    包括向量数据库的设置和知识库数据的加载
    """

    try:

        # 重置ChromaDB客户端，清理现有数据
        reset_client()

        # 获取ChromaDB客户端和嵌入模型
        # logger.info("📦 获取ChromaDB客户端和嵌入模型...")
        # embedding_model = get_embedding_model()
        # assert embedding_model is not None, "嵌入模型未加载成功"

        # 加载测试知识库数据到向量数据库
        # logger.info("🔄 加载测试知识库到向量数据库...")
        success = load_knowledge_base_to_vector_db(
            knowledge_base=test_knowledge_base1,
            embedding_model=multilingual_model,
            collection=get_default_collection(),
        )

        if success:
            logger.success("✅ 测试知识库加载成功")

            # 测试向量检索功能
            # _test_chromadb_search()

        else:
            logger.error("❌ 测试知识库加载失败")
            raise Exception("知识库加载失败")

    except ImportError as e:
        logger.error(f"❌ 无法导入ChromaDB相关模块: {e}")
        raise
    except Exception as e:
        logger.error(f"❌ ChromaDB初始化过程中发生错误: {e}")
        raise


#######################################################################################################
def main() -> None:

    logger.info("🚀 开始初始化开发环境...")

    # PostgreSQL 相关操作
    try:
        logger.info("�️ 删除旧数据库（如果存在）...")
        pgsql_drop_database(postgresql_config.database)

        logger.info("📦 创建新数据库...")
        pgsql_create_database(postgresql_config.database)

        logger.info("📋 创建数据库表结构...")
        pgsql_ensure_database_tables()

        logger.success("✅ PostgreSQL 初始化完成")
    except Exception as e:
        logger.error(f"❌ PostgreSQL 初始化失败: {e}")

    # Redis 相关操作
    try:
        logger.info("🚀 清空 Redis 数据库...")
        redis_flushall()
        logger.success("✅ Redis 初始化完成")
    except Exception as e:
        logger.error(f"❌ Redis 初始化失败: {e}")

    # MongoDB 相关操作
    try:
        logger.info("🚀 清空 MongoDB 数据库...")
        mongodb_clear_database()
        logger.success("✅ MongoDB 清空完成")

    except Exception as e:
        logger.error(f"❌ MongoDB 初始化失败: {e}")

    # ChromaDB 相关操作
    try:
        logger.info("🚀 初始化ChromaDB...")
        _setup_chromadb()
        logger.success("✅ ChromaDB 初始化完成")
    except Exception as e:
        logger.error(f"❌ ChromaDB 初始化失败: {e}")

    logger.info("🎉 开发环境初始化完成")


#######################################################################################################
# Main execution
if __name__ == "__main__":
    main()

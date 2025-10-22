import os
import sys


# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)
from loguru import logger


from magic_book.mongodb import (
    mongodb_clear_database,
)
from magic_book.pgsql import (
    pgsql_create_database,
    pgsql_drop_database,
    pgsql_ensure_database_tables,
    postgresql_config,
)
from magic_book.redis.client import (
    redis_flushall,
)


#######################################################################################################
def _setup_chromadb() -> None:
    """
    清理现有的ChromaDB数据，然后使用正式的知识库数据重新初始化.
    包括向量数据库的设置和知识库数据的加载
    """

    # 导入必要的模块
    from magic_book.chroma import reset_client

    try:

        # 重置ChromaDB客户端，清理现有数据
        reset_client()

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

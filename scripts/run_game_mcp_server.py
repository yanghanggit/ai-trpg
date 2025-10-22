#!/usr/bin/env python3
"""
TCG 游戏 MCP 服务器 - 提供 RAG 知识库查询功能

基于 MCP 2025-06-18 规范的 Streamable HTTP 传输实现。

功能特点：
1. 艾尔法尼亚RPG世界知识库查询
2. 语义搜索和上下文检索
3. RAG (Retrieval-Augmented Generation) 支持
4. 生产级日志记录和错误处理

使用方法：
    python scripts/run_tcg_game_mcp_server.py
"""

import os
import sys
import json
from datetime import datetime

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from loguru import logger
from mcp.server.fastmcp import FastMCP
from magic_book.mcp import mcp_config
from magic_book.game.config import setup_logger
from magic_book.rag.knowledge_retrieval import search_similar_documents
from magic_book.chroma import get_default_collection
from magic_book.embedding_model.sentence_transformer import get_embedding_model
from fastapi import Request, Response

# ============================================================================
# 初始化日志系统
# ============================================================================

setup_logger()

# ============================================================================
# 创建 FastMCP 应用实例
# ============================================================================

app = FastMCP(
    name=mcp_config.server_name,
    instructions=mcp_config.server_description,
    debug=True,  # HTTP 模式可以启用调试
)


# ============================================================================
# 注册健康检查端点
# ============================================================================
@app.custom_route("/health", methods=["POST"])  # type: ignore[misc]
async def health_check(request: Request) -> Response:
    """处理 MCP 健康检查请求"""
    try:
        # 解析请求体
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        # 检查是否是 ping 方法
        if data.get("method") == "ping":
            response_data = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "result": {"status": "ok"},
            }
            return Response(
                content=json.dumps(response_data),
                media_type="application/json",
                status_code=200,
            )
        else:
            error_response = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "error": {"code": -32601, "message": "Method not found"},
            }
            return Response(
                content=json.dumps(error_response),
                media_type="application/json",
                status_code=200,
            )
    except Exception as e:
        error_response = {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32700, "message": f"Parse error: {str(e)}"},
        }
        return Response(
            content=json.dumps(error_response),
            media_type="application/json",
            status_code=400,
        )


# ============================================================================
# 注册 RAG 工具
# ============================================================================
@app.tool()
async def rag_query(query: str, context_limit: int = 5) -> str:
    """
    艾尔法尼亚RPG世界知识库查询工具

    专门用于查询艾尔法尼亚RPG游戏世界的相关信息，包括：
    - 王国历史和背景设定（阿斯特拉王国、月桂森林联邦、铁爪部族联盟）
    - 角色人物和种族信息（人类、精灵、兽人、勇者、魔王等）
    - 武器装备和道具属性（圣剑晨曦之刃、魔法药水、时之沙漏等）
    - 地图场景和遗迹描述（封印之塔、贤者之塔、暗影墓地等）
    - 魔法技能和战斗系统（五大魔法学派、圣剑技能等）
    - 剧情故事和组织关系（魔王封印、冒险者公会等）

    注意：此工具仅适用于艾尔法尼亚RPG游戏世界相关查询，不处理其他主题。

    Args:
        query: 关于艾尔法尼亚RPG游戏世界的查询问题或关键词
        context_limit: 返回相关上下文的数量限制

    Returns:
        查询结果的JSON字符串，包含相关文档和相似度分数
    """
    try:
        logger.info(f"🔍 RAG查询请求: query='{query}', context_limit={context_limit}")

        # 获取必要的依赖
        embedding_model = get_embedding_model()

        if embedding_model is None:
            logger.error("❌ 嵌入模型未初始化")
            return json.dumps(
                {
                    "status": "error",
                    "message": "嵌入模型未初始化",
                    "documents": [],
                    "total_count": 0,
                }
            )

        # 调用RAG语义搜索函数
        documents, similarity_scores = search_similar_documents(
            query, get_default_collection(), embedding_model, top_k=context_limit
        )

        # 构建返回结果
        if documents and similarity_scores:
            # 成功检索到相关文档
            results = []
            for i, (doc, score) in enumerate(zip(documents, similarity_scores)):
                results.append(
                    {
                        "rank": i + 1,
                        "content": doc,
                        "similarity_score": round(score, 4),
                        "relevance": (
                            "high"
                            if score > 0.7
                            else "medium" if score > 0.4 else "low"
                        ),
                    }
                )

            response = {
                "status": "success",
                "query": query,
                "total_results": len(results),
                "context_limit": context_limit,
                "results": results,
                "timestamp": datetime.now().isoformat(),
            }

            logger.info(f"✅ RAG查询成功，返回 {len(results)} 个相关文档")

        else:
            # 未找到相关文档
            response = {
                "status": "no_results",
                "query": query,
                "total_results": 0,
                "context_limit": context_limit,
                "results": [],
                "message": "未找到与查询相关的文档",
                "timestamp": datetime.now().isoformat(),
            }

            logger.warning(f"⚠️ RAG查询未找到相关文档: '{query}'")

        return json.dumps(response, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"❌ RAG查询失败: {e}")
        error_result = {
            "status": "error",
            "query": query,
            "context_limit": context_limit,
            "error": str(e),
            "message": f"RAG查询过程中发生错误: {str(e)}",
            "timestamp": datetime.now().isoformat(),
        }
        return json.dumps(error_result, ensure_ascii=False, indent=2)


def main() -> None:
    """启动 TCG 游戏 MCP 服务器"""

    logger.info(
        f"🎯 启动游戏 MCP 服务器 {mcp_config.server_name} v{mcp_config.server_version}"
    )
    logger.info(f"📡 传输协议: {mcp_config.transport} ({mcp_config.protocol_version})")
    logger.info(
        f"🌐 服务地址: http://{mcp_config.mcp_server_host}:{mcp_config.mcp_server_port}"
    )
    logger.info(f"🔍 支持功能: RAG知识库查询")

    # 配置 FastMCP 设置
    app.settings.host = mcp_config.mcp_server_host
    app.settings.port = mcp_config.mcp_server_port

    try:
        # 启动 HTTP 服务器
        logger.info("✅ 游戏 MCP 服务器启动完成，等待客户端连接...")
        app.run(transport="streamable-http")
    except KeyboardInterrupt:
        logger.info("🛑 收到中断信号，正在关闭服务器...")
    except Exception as e:
        logger.error(f"❌ 服务器启动失败: {e}")
        raise
    finally:
        logger.info("👋 游戏 MCP 服务器已关闭")


if __name__ == "__main__":
    main()

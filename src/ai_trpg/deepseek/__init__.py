"""
DeepSeek 聊天服务模块

本模块包含基于 DeepSeek 的各种聊天服务实现：
- 基础聊天图（chat_graph.py）
- RAG 增强聊天图（rag_graph.py）
- MCP 客户端聊天图（mcp_client_graph.py）
- 统一聊天图（unified_chat_graph.py）
"""

from .chat_graph import create_chat_workflow, execute_chat_workflow, ChatState
from .rag_graph import (
    create_rag_workflow,
    execute_rag_workflow,
    RAGState,
)
from .document_retriever import DocumentRetriever
from .mcp_client_graph import (
    create_mcp_workflow,
    execute_mcp_workflow,
    McpState,
)
from .client import create_deepseek_llm

__all__ = [
    # 基础聊天图
    "create_chat_workflow",
    "execute_chat_workflow",
    "ChatState",
    # RAG 聊天图
    "RAGState",
    "DocumentRetriever",
    "create_rag_workflow",
    "execute_rag_workflow",
    # MCP 客户端聊天图
    "create_mcp_workflow",
    "execute_mcp_workflow",
    "McpState",
    # 创建 DeepSeek LLM 实例
    "create_deepseek_llm",
]

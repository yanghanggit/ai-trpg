#!/usr/bin/env python3
"""
工作流执行器模块

提供各种工作流（MCP、Chat、RAG）的执行函数。
"""

from typing import List
from langchain.schema import AIMessage, BaseMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from loguru import logger
from ai_trpg.deepseek import (
    execute_mcp_workflow,
    execute_chat_workflow,
    execute_rag_workflow,
    create_mcp_workflow,
    create_chat_workflow,
    create_rag_workflow,
    DocumentRetriever,
)
from ai_trpg.mcp import McpClient


#############################################################################################################
async def handle_mcp_workflow_execution(
    agent_name: str,
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    mcp_client: McpClient,
) -> List[BaseMessage]:
    """处理MCP工具调用工作流

    Args:
        agent_name: 代理名称，用于日志输出
        context: 历史消息列表
        request: 用户当前输入的消息
        llm: ChatDeepSeek LLM 实例
        mcp_client: MCP 客户端实例

    Returns:
        List[BaseMessage]: AI响应消息列表
    """
    logger.debug(f"{agent_name}:\n{request.content}")

    mcp_response = await execute_mcp_workflow(
        work_flow=create_mcp_workflow(),
        context=context,
        request=request,
        llm=llm,
        mcp_client=mcp_client,
    )

    # 显示最新的AI回复
    if mcp_response:
        for msg in mcp_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{agent_name}:\n{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return mcp_response


#############################################################################################################
async def handle_chat_workflow_execution(
    agent_name: str,
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
) -> List[BaseMessage]:
    """执行纯聊天工作流（不涉及工具调用）

    Args:
        agent_name: 代理名称，用于日志输出
        context: 历史消息列表
        request: 用户当前输入的消息
        llm: ChatDeepSeek LLM 实例

    Returns:
        List[BaseMessage]: AI响应消息列表
    """

    logger.debug(f"{agent_name}:\n{request.content}")

    chat_response = await execute_chat_workflow(
        work_flow=create_chat_workflow(),
        context=context,
        request=request,
        llm=llm,
    )

    # 显示最新的AI回复
    if chat_response:
        for msg in chat_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{agent_name}:\n{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return chat_response


#############################################################################################################
async def handle_rag_workflow_execution(
    agent_name: str,
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    document_retriever: DocumentRetriever,
    min_similarity_threshold: float = 0.05,
    top_k_documents: int = 3,
) -> List[BaseMessage]:
    """执行 RAG 工作流

    Args:
        agent_name: 代理名称，用于日志输出
        context: 历史消息列表
        request: 用户当前输入的消息
        llm: ChatDeepSeek LLM 实例
        document_retriever: 文档检索器实例
        min_similarity_threshold: 相似度阈值（默认 0.05）
        top_k_documents: 检索文档数量（默认 3）

    Returns:
        List[BaseMessage]: AI响应消息列表
    """
    logger.debug(f"{agent_name}:\n{request.content}")

    rag_response = await execute_rag_workflow(
        work_flow=create_rag_workflow(),
        context=context,
        request=request,
        llm=llm,
        document_retriever=document_retriever,
        min_similarity_threshold=min_similarity_threshold,
        top_k_documents=top_k_documents,
    )

    # 显示最新的AI回复
    if rag_response:
        for msg in rag_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{agent_name}:\n{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return rag_response

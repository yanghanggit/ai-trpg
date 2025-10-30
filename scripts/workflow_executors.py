#!/usr/bin/env python3
"""
工作流执行器模块

提供各种工作流（MCP、Chat、RAG）的执行函数。
"""

from typing import List
from langchain.schema import AIMessage, BaseMessage
from loguru import logger

from magic_book.deepseek import (
    McpState,
    execute_mcp_workflow,
    ChatState,
    execute_chat_workflow,
    RAGState,
    execute_rag_workflow,
    create_mcp_workflow,
    create_chat_workflow,
    create_rag_workflow,
)


#############################################################################################################
async def execute_mcp_state_workflow(
    context: McpState,
    request: McpState,
) -> List[BaseMessage]:
    """处理普通用户消息：发送给AI处理"""
    user_message = request["messages"][0] if request.get("messages") else None
    if user_message:
        logger.debug(f"{user_message.content}")

    mcp_response = await execute_mcp_workflow(
        work_flow=create_mcp_workflow(),
        context=context,
        request=request,
    )

    # 显示最新的AI回复
    if mcp_response:
        for msg in mcp_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return mcp_response


#############################################################################################################
async def execute_chat_state_workflow(
    context: ChatState,
    request: ChatState,
) -> List[BaseMessage]:
    """执行纯聊天工作流（不涉及工具调用）

    Args:
        user_input_state: 用户输入状态（包含用户消息和LLM实例）
        chat_history_state: 聊天历史状态（包含历史消息和LLM实例）
        work_flow: 编译后的聊天工作流状态图
        should_append_to_history: 是否将本次对话追加到历史记录（默认True）

    Returns:
        List[BaseMessage]: AI响应消息列表
    """

    user_message = request["messages"][0] if request.get("messages") else None
    if user_message:
        logger.debug(f"{user_message.content}")

    chat_response = await execute_chat_workflow(
        work_flow=create_chat_workflow(),
        context=context,
        request=request,
    )

    # 显示最新的AI回复
    if chat_response:
        for msg in chat_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return chat_response


#############################################################################################################
async def execute_rag_workflow_handler(
    context: RAGState,
    request: RAGState,
) -> List[BaseMessage]:
    """执行 RAG 工作流

    Args:
        user_input_state: 用户输入状态（包含用户消息、LLM实例和检索器）
        chat_history_state: 聊天历史状态（包含历史消息、LLM实例和检索器）
        work_flow: 编译后的 RAG 工作流状态图
        should_append_to_history: 是否将本次对话追加到历史记录（默认True）

    Returns:
        List[BaseMessage]: AI响应消息列表
    """
    user_message = request["messages"][0] if request.get("messages") else None
    if user_message:
        logger.debug(f"{user_message.content}")

    rag_response = await execute_rag_workflow(
        work_flow=create_rag_workflow(),
        context=context,
        request=request,
    )

    # 显示最新的AI回复
    if rag_response:
        for msg in rag_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return rag_response

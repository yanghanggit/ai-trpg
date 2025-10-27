#!/usr/bin/env python3
"""
工作流执行器模块

提供各种工作流（MCP、Chat、RAG）的执行函数。
"""

from typing import Any, List
from langchain.schema import AIMessage, BaseMessage
from langgraph.graph.state import CompiledStateGraph
from loguru import logger

from magic_book.deepseek import (
    McpState,
    execute_mcp_workflow,
    ChatState,
    execute_chat_workflow,
    RAGState,
    execute_rag_workflow,
)


async def execute_mcp_state_workflow(
    user_input_state: McpState,
    chat_history_state: McpState,
    work_flow: CompiledStateGraph[McpState, Any, McpState, McpState],
    should_append_to_history: bool = True,
) -> List[BaseMessage]:
    """处理普通用户消息：发送给AI处理"""
    user_message = (
        user_input_state["messages"][0] if user_input_state.get("messages") else None
    )
    if user_message:
        logger.success(f"💬 处理用户输入（MCP）: \n{user_message.content}")

    update_messages = await execute_mcp_workflow(
        state_compiled_graph=work_flow,
        chat_history_state=chat_history_state,
        user_input_state=user_input_state,
    )

    # 更新聊天历史
    if should_append_to_history:
        chat_history_state["messages"].extend(user_input_state["messages"])
        chat_history_state["messages"].extend(update_messages)

    # 显示最新的AI回复
    if update_messages:
        for msg in update_messages:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return update_messages


def execute_chat_state_workflow(
    user_input_state: ChatState,
    chat_history_state: ChatState,
    work_flow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
    should_append_to_history: bool = True,
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
    user_message = (
        user_input_state["messages"][0] if user_input_state.get("messages") else None
    )
    if user_message:
        logger.success(f"💬 处理用户输入（纯聊天）: \n{user_message.content}")

    update_messages = execute_chat_workflow(
        state_compiled_graph=work_flow,
        chat_history_state=chat_history_state,
        user_input_state=user_input_state,
    )

    # 更新聊天历史
    if should_append_to_history:
        chat_history_state["messages"].extend(user_input_state["messages"])
        chat_history_state["messages"].extend(update_messages)

    # 显示最新的AI回复
    if update_messages:
        for msg in update_messages:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return update_messages


def execute_rag_workflow_handler(
    user_input_state: RAGState,
    chat_history_state: RAGState,
    work_flow: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    should_append_to_history: bool = True,
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
    user_message = (
        user_input_state["messages"][0] if user_input_state.get("messages") else None
    )
    if user_message:
        logger.success(f"💬 处理用户输入（RAG）: \n{user_message.content}")

    update_messages = execute_rag_workflow(
        rag_compiled_graph=work_flow,
        chat_history_state=chat_history_state,
        user_input_state=user_input_state,
    )

    # 更新聊天历史
    if should_append_to_history:
        chat_history_state["messages"].extend(user_input_state["messages"])
        chat_history_state["messages"].extend(update_messages)

    # 显示最新的AI回复
    if update_messages:
        for msg in update_messages:
            assert isinstance(msg, AIMessage)
            logger.info(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return update_messages

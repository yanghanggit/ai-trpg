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
    McpState,
    execute_mcp_workflow,
    execute_chat_workflow,
    RAGState,
    execute_rag_workflow,
    create_mcp_workflow,
    create_chat_workflow,
    create_rag_workflow,
)


#############################################################################################################
async def handle_mcp_workflow_execution(
    agent_name: str,
    context: McpState,
    request: McpState,
) -> List[BaseMessage]:
    """处理普通用户消息：发送给AI处理"""
    user_message = request["messages"][0] if request.get("messages") else None
    if user_message:
        logger.debug(f"{agent_name}:\n{user_message.content}")

    mcp_response = await execute_mcp_workflow(
        work_flow=create_mcp_workflow(),
        context=context,
        request=request,
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
        logger.debug(f"{agent_name}:\n{user_message.content}")

    rag_response = await execute_rag_workflow(
        work_flow=create_rag_workflow(),
        context=context,
        request=request,
    )

    # 显示最新的AI回复
    if rag_response:
        for msg in rag_response:
            assert isinstance(msg, AIMessage)
            logger.info(f"{agent_name}:\n{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return rag_response

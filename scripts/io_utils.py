#!/usr/bin/env python3
"""
输入输出工具模块

提供格式化、日志等输入输出相关的工具函数。
"""

from typing import List
from langchain.schema import BaseMessage, HumanMessage, SystemMessage, AIMessage
from loguru import logger


def format_user_input_prompt(user_input: str) -> str:
    """格式化用户输入为标准的提示词格式

    Args:
        user_input: 用户的原始输入内容

    Returns:
        格式化后的提示词字符串
    """
    return f"""# 用户请求

{user_input}

**输出要求**: 简洁纯文本一段,不重复历史内容,不使用任何标记格式。"""


def log_chat_history(messages: List[BaseMessage]) -> None:
    """打印对话历史"""

    if not messages:
        logger.info("📜 对话历史为空")
        return

    logger.info(f"📜 对话历史：数量 = {len(messages)}")

    for i, message in enumerate(messages):
        if isinstance(message, HumanMessage):
            logger.debug(f"👤 HumanMessage [{i}]: {message.content}")
        elif isinstance(message, SystemMessage):
            logger.debug(f"⚙️ SystemMessage [{i}]: {message.content}")
        elif isinstance(message, AIMessage):
            logger.debug(f"🤖 AIMessage [{i}]: {message.content}")

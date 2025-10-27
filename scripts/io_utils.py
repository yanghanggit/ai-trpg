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
    return f"""# 消息！

## 消息内容

{user_input}

## 输出内容

**约束**！不要重复输出过往内容。
输出内容尽量简洁明了，避免冗长。

## 输出格式要求

输出内容须是 一整段 简洁的文本描述，不允许包含任何其他格式或标记。"""


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

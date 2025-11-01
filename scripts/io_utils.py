#!/usr/bin/env python3
"""
输入输出工具模块

提供格式化、日志等输入输出相关的工具函数。
"""

import json
from datetime import datetime
from typing import List
from langchain.schema import BaseMessage, HumanMessage, SystemMessage, AIMessage
from loguru import logger
from ai_trpg.configuration.game import LOGS_DIR


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


def log_history(agent_name: str, messages: List[BaseMessage]) -> None:
    """打印对话历史"""

    if not messages:
        logger.info(f"📜 对话历史为空 [{agent_name}]")
        return

    logger.info(f"📜 对话历史：数量 = {len(messages)}")

    for i, message in enumerate(messages):
        if isinstance(message, HumanMessage):
            logger.debug(f"👤 HumanMessage [{i}]: {message.content}")
        elif isinstance(message, SystemMessage):
            logger.debug(f"⚙️ SystemMessage [{i}]: {message.content}")
        elif isinstance(message, AIMessage):
            logger.debug(f"🤖 AIMessage [{i}]: {message.content}")


def dump_history(
    agent_name: str,
    messages: List[BaseMessage],
) -> None:

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    json_filename = f"{agent_name}_{timestamp}.json"
    json_filepath = LOGS_DIR / json_filename

    try:
        # 将每个 BaseMessage 转换为字典
        messages_data = [message.model_dump() for message in messages]

        # 保存为 JSON 文件
        json_filepath.write_text(
            json.dumps(messages_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        logger.debug(f"💾 对话历史已保存到: {json_filepath}")
    except Exception as e:
        logger.error(f"❌ 保存对话历史失败: {e}")

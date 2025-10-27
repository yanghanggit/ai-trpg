#!/usr/bin/env python3
"""
代理工具模块

提供游戏代理相关的工具函数，包括代理切换、管理等功能。
"""

from typing import List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import BaseMessage


class GameAgent(BaseModel):
    """游戏代理模型"""

    name: str
    type: str
    chat_history: List[BaseMessage] = []


def switch_agent(
    all_agents: List[GameAgent], target_name: str, current_agent: GameAgent
) -> GameAgent | None:
    """切换到指定名称的代理

    Args:
        all_agents: 所有可用的代理列表
        target_name: 目标代理的名称
        current_agent: 当前激活的代理

    Returns:
        如果找到目标代理则返回该代理，否则返回 None
    """
    # 检查是否尝试切换到当前代理
    if target_name == current_agent.name:
        logger.warning(f"⚠️ 你已经是该角色代理 [{current_agent.name}]，无需切换")
        return None

    # 在所有代理中查找目标代理
    for agent in all_agents:
        if agent.name == target_name:
            logger.success(f"✅ 切换代理: [{current_agent.name}] → [{agent.name}]")
            return agent

    # 未找到目标代理
    logger.error(f"❌ 未找到角色代理: {target_name}")
    return None

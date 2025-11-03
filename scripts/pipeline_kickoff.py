#!/usr/bin/env python3
"""
游戏流水线 - 开局初始化模块

负责处理游戏场景和角色的开局初始化（Kickoff）流程。
"""

import json
from typing import List
from loguru import logger
from langchain.schema import HumanMessage
from ai_trpg.mcp import McpClient
from agent_utils import GameAgent


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_all_kickoff(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
) -> None:
    """处理所有代理的开局初始化

    读取场景信息并通知场景代理和所有角色代理游戏开始。

    Args:
        stage_agent: 场景代理
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端
    """

    try:

        stage_resource_uri = f"game://stage/{stage_agent.name}"
        stage_resource_response = await mcp_client.read_resource(stage_resource_uri)
        if stage_resource_response is None or stage_resource_response.text is None:
            logger.error(f"❌ 未能读取资源: {stage_resource_uri}")
            return

        stage_info_data = json.loads(stage_resource_response.text)

        narrative = stage_info_data.get("narrative", "")
        assert narrative != "", "场景叙事不能为空"

        actor_states = stage_info_data.get("actor_states", "")
        assert actor_states != "", "场景角色状态不能为空"

        environment = stage_info_data.get("environment", "")
        assert environment != "", "场景环境状态不能为空"

        # 通知场景代理场景叙事和角色状态
        stage_narrative_notification = f"""# {stage_agent.name}
        
{narrative}"""

        stage_agent.context.append(HumanMessage(content=stage_narrative_notification))
        logger.debug(
            f"✅ 场景 {stage_agent.name} kickoff = \n{stage_narrative_notification}"
        )

        for actor_agent in actor_agents:
            actor_agent.context.append(
                HumanMessage(content=stage_narrative_notification)
            )
            logger.debug(
                f"✅ 角色 {actor_agent.name} kickoff = \n{stage_narrative_notification}"
            )

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")

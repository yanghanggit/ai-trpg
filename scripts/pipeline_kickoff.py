#!/usr/bin/env python3
"""
游戏流水线 - 开局初始化模块

负责处理游戏场景和角色的开局初始化（Kickoff）流程。
"""

from typing import Any, Dict
from loguru import logger
from langchain.schema import HumanMessage
from agent_utils import StageAgent
from mcp_client_resource_helpers import read_stage_resource


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_kickoff(
    stage_agent: StageAgent,
    # mcp_client: McpClient,
) -> None:
    """处理所有代理的开局初始化

    读取场景信息并通知场景代理和所有角色代理游戏开始。

    Args:
        stage_agent: 场景代理
        mcp_client: MCP 客户端
    """

    try:

        # 使用统一的资源读取函数
        stage_info_data: Dict[str, Any] = await read_stage_resource(
            stage_agent.mcp_client, stage_agent.name
        )

        narrative = stage_info_data.get("narrative", "")
        assert narrative != "", "场景叙事不能为空"

        actor_states = stage_info_data.get("actor_states", "")
        if actor_states == "":
            logger.warning(f"⚠️ 场景 {stage_agent.name} 角色状态为空")
            assert len(stage_agent.actor_agents) == 0, "场景有角色但角色状态为空"
        # assert actor_states != "", "场景角色状态不能为空"

        environment = stage_info_data.get("environment", "")
        assert environment != "", "场景环境状态不能为空"

        # 通知场景代理场景叙事和角色状态
        kickoff_prompt = f"""# {stage_agent.name}
        
{narrative}"""

        if not stage_agent.is_kicked_off:
            stage_agent.context.append(HumanMessage(content=kickoff_prompt))
            stage_agent.is_kicked_off = True
            logger.info(f"✅ 场景 {stage_agent.name} kickoff = \n{kickoff_prompt}")

        for actor_agent in stage_agent.actor_agents:

            if actor_agent.is_kicked_off:
                continue
            actor_agent.context.append(HumanMessage(content=kickoff_prompt))
            actor_agent.is_kicked_off = True
            logger.info(f"✅ 角色 {actor_agent.name} kickoff = \n{kickoff_prompt}")

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")

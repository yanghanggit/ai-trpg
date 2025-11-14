#!/usr/bin/env python3
"""
游戏流水线 - 开局初始化模块

负责处理游戏场景和角色的开局初始化（Kickoff）流程。
"""

import asyncio
from typing import Any, Dict
from loguru import logger
from langchain.schema import HumanMessage
from agent_utils import StageAgent, GameAgentManager
from mcp_client_resource_helpers import read_stage_resource
from ai_trpg.pgsql import add_stage_context, add_actor_context


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _kickoff_stage_agent(stage_agent: StageAgent) -> None:
    """处理单个场景代理的开局初始化

    Args:
        stage_agent: 场景代理
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

        environment = stage_info_data.get("environment", "")
        assert environment != "", "场景环境状态不能为空"

        # 通知场景代理场景叙事和角色状态
        kickoff_prompt = f"""# {stage_agent.name}
        
{narrative}"""

        # 添加 kickoff 消息到数据库
        add_stage_context(
            stage_agent.world_id,
            stage_agent.name,
            [HumanMessage(content=kickoff_prompt)],
        )
        logger.info(f"✅ 场景 {stage_agent.name} kickoff = \n{kickoff_prompt}")

        # 批量添加所有角色的 kickoff 消息到数据库
        for actor_agent in stage_agent.actor_agents:
            add_actor_context(
                actor_agent.world_id,
                actor_agent.name,
                [HumanMessage(content=kickoff_prompt)],
            )
            logger.info(f"✅ 角色 {actor_agent.name} kickoff = \n{kickoff_prompt}")

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")


async def handle_kickoff(
    game_agent_manager: GameAgentManager,
    use_concurrency: bool = False,
) -> None:
    """处理所有代理的开局初始化

    读取场景信息并通知场景代理和所有角色代理游戏开始。

    Args:
        game_agent_manager: 游戏代理管理器
        use_concurrency: 是否使用并发处理
    """

    if game_agent_manager._is_kicked_off:
        logger.info("⚠️ 游戏已完成开局初始化，跳过重复执行 kickoff 流程")
        return

    logger.info("🎮 开始开局初始化流程...")

    stage_agents = game_agent_manager.stage_agents
    if len(stage_agents) == 0:
        logger.warning("⚠️ 没有可用的场景代理，无法进行开局初始化")
        return

    if use_concurrency:
        logger.debug(f"🔄 并行处理 {len(stage_agents)} 个场景的开局初始化")
        kickoff_tasks = [
            _kickoff_stage_agent(stage_agent) for stage_agent in stage_agents
        ]
        await asyncio.gather(*kickoff_tasks, return_exceptions=True)
    else:
        logger.debug(f"🔄 顺序处理 {len(stage_agents)} 个场景的开局初始化")
        for stage_agent in stage_agents:
            await _kickoff_stage_agent(stage_agent)

    # 标记整个游戏已完成开局初始化
    game_agent_manager._is_kicked_off = True
    logger.info("✅ 开局初始化流程完成")

#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

from typing import List
from loguru import logger
from ai_trpg.mcp import McpClient
from agent_utils import GameAgentManager, StageAgent

# 导入拆分后的流水线模块
from pipeline_kickoff import handle_kickoff
from pipeline_actor_observe_and_plan import handle_actors_observe_and_plan
from pipeline_stage_execute import (
    handle_stage_execute,
)
from pipeline_actor_self_update import handle_actors_self_update
from pipeline_stage_self_update import handle_stage_self_update


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _all_kickoff(stage_agents: List[StageAgent], mcp_client: McpClient) -> None:
    """让所有的场景代理开始开局初始化（Kickoff）"""
    for stage_agent in stage_agents:
        await handle_kickoff(
            stage_agent=stage_agent,
            mcp_client=mcp_client,
        )


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_game_command(
    command: str,
    game_agent_manager: GameAgentManager,
    mcp_client: McpClient,
) -> None:
    """处理游戏指令

    Args:
        command: 游戏指令内容
        game_agent_manager: 游戏代理管理器
        mcp_client: MCP 客户端实例
    """
    logger.info(f"🎮 游戏指令: {command}")

    # 从代理管理器获取代理列表
    stage_agents = game_agent_manager.stage_agents
    assert len(stage_agents) > 0, "没有可用的场景代理"

    # 获取 MCP 可用工具列表
    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "获取 MCP 可用工具失败"

    match command:

        # /game all:kickoff - 让所有的代理开始行动（Kickoff）
        case "all:kickoff":
            await _all_kickoff(stage_agents, mcp_client)

        # /game all:actors_observe_and_plan - 让所有角色代理观察场景并规划行动
        case "all:actors_observe_and_plan":

            for stage_agent in stage_agents:

                await handle_actors_observe_and_plan(
                    stage_agent=stage_agent,
                    mcp_client=mcp_client,
                    use_concurrency=True,
                )

        # /game all:actor_plans_and_update_stage - 让场景代理执行所有角色的行动计划
        case "all:actor_plans_and_update_stage":

            for stage_agent in stage_agents:
                await handle_stage_execute(
                    stage_agent=stage_agent,
                    mcp_client=mcp_client,
                )

        # /game all:actors_self_update - 让所有角色进行自我更新
        case "all:actors_self_update":

            await handle_actors_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game all:stage_self_update - 让所有场景进行自我更新
        case "all:stage_self_update":

            await handle_stage_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game pipeline:test0 - 测试流水线0: 开局→观察规划
        case "pipeline:test0":

            await _all_kickoff(stage_agents, mcp_client)

            # 步骤0: 所有角色开始行动（Kickoff）
            for stage_agent in stage_agents:

                # 步骤1: 所有角色观察场景并规划行动
                await handle_actors_observe_and_plan(
                    stage_agent=stage_agent,
                    mcp_client=mcp_client,
                    use_concurrency=True,
                )

        # /game pipeline:test1 - 测试流水线1: 开局→观察规划→执行更新循环
        # 注意: 假设第0帧 已通过初始化注入stage_agent
        case "pipeline:test1":

            await _all_kickoff(stage_agents, mcp_client)

            # 步骤0: 所有角色开始行动（Kickoff）
            for stage_agent in stage_agents:

                # 步骤1: 所有角色观察场景并规划行动
                await handle_actors_observe_and_plan(
                    stage_agent=stage_agent,
                    mcp_client=mcp_client,
                    use_concurrency=True,
                )

                # 步骤2: 场景执行计划并生成新的状态快照
                # 输出的状态快照将成为下一轮的输入
                await handle_stage_execute(
                    stage_agent=stage_agent,
                    mcp_client=mcp_client,
                )

            # 步骤3: 所有角色进行状态更新
            await handle_actors_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

            # 步骤4: 所有场景进行状态更新
            await handle_stage_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game pipeline:test2 - 测试流水线2: 开局→所有角色自我更新
        # 注意: 假设第0帧 已通过初始化注入stage_agent
        case "pipeline:test2":

            # 步骤0: 所有角色开始行动（Kickoff）
            await _all_kickoff(stage_agents, mcp_client)

            # 步骤1: 所有角色进行状态更新
            await handle_actors_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

            # 步骤2: 所有场景进行状态更新
            await handle_stage_self_update(
                game_agent_manager=game_agent_manager,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

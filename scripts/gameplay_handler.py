#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

from typing import List
from loguru import logger
from ai_trpg.mcp import McpClient
from agent_utils import GameAgent

# 导入拆分后的流水线模块
from pipeline_kickoff import handle_all_kickoff
from pipeline_observe_and_plan import handle_all_actors_observe_and_plan
from pipeline_execute_stage import orchestrate_actor_plans_and_update_stage
from pipeline_actor_self_update import handle_all_actors_self_update


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_game_command(
    command: str,
    current_agent: GameAgent,
    all_agents: List[GameAgent],
    world_agent: GameAgent,
    stage_agents: List[GameAgent],
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
) -> None:
    """处理游戏指令

    Args:
        command: 游戏指令内容
        current_agent: 当前激活的代理
        all_agents: 所有可用的代理列表
        llm: DeepSeek LLM 实例
        mcp_client: MCP 客户端实例
        available_tools: 可用的工具列表
        available_prompts: 可用的提示词模板列表
        available_resources: 可用的资源列表
        mcp_workflow: MCP 工作流状态图
        chat_workflow: Chat 工作流状态图
        rag_workflow: RAG 工作流状态图
        game_retriever: 游戏文档检索器
    """
    logger.info(f"🎮 游戏指令: {command}")

    assert len(stage_agents) > 0, "没有可用的场景代理"
    assert len(actor_agents) > 0, "没有可用的角色代理"

    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "获取 MCP 可用工具失败"

    match command:

        # /game all:kickoff - 让所有的代理开始行动（Kickoff）
        case "all:kickoff":

            await handle_all_kickoff(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
            )

        # /game all_actors:observe_and_plan - 让所有角色代理观察场景并规划行动
        case "all_actors:observe_and_plan":
            await handle_all_actors_observe_and_plan(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game stage:orchestrate_actor_plans_and_update_stage - 让场景代理执行所有角色的行动计划
        case "stage:orchestrate_actor_plans_and_update_stage":

            await orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
            )

        # /game all_actors:self_update - 让所有角色进行自我更新
        case "all_actors:self_update":

            await handle_all_actors_self_update(
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game pipeline:test0 - 测试流水线0: 开局→观察规划
        case "pipeline:test0":

            # 步骤0: 所有角色开始行动（Kickoff）
            await handle_all_kickoff(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
            )

            # 步骤1: 所有角色观察场景并规划行动
            await handle_all_actors_observe_and_plan(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game pipeline:test1 - 测试流水线1: 开局→观察规划→执行更新循环
        # 注意: 假设第0帧 已通过初始化注入stage_agent
        case "pipeline:test1":

            # 步骤0: 所有角色开始行动（Kickoff）
            await handle_all_kickoff(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
            )

            # 步骤1: 所有角色观察场景并规划行动
            await handle_all_actors_observe_and_plan(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

            # 步骤2: 场景执行计划并生成新的状态快照
            # 输出的状态快照将成为下一轮的输入
            await orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
            )

            # 步骤3: 所有角色进行状态更新
            # await handle_all_actors_self_update(
            #     actor_agents=actor_agents,
            #     mcp_client=mcp_client,
            #     use_concurrency=True,
            # )

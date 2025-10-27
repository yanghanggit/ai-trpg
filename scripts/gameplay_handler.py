#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

from typing import List, Any
from langgraph.graph.state import CompiledStateGraph
from loguru import logger
from langchain_deepseek import ChatDeepSeek
from magic_book.deepseek import McpState, ChatState, RAGState
from magic_book.mcp import McpClient, McpToolInfo, McpPromptInfo, McpResourceInfo
from magic_book.rag.game_retriever import GameDocumentRetriever
from agent_utils import GameAgent
from workflow_executors import (
    execute_mcp_state_workflow,
    execute_chat_state_workflow,
)
from langchain.schema import HumanMessage


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_stage_refresh(
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    mcp_client: McpClient,
    available_tools: List[McpToolInfo],
    mcp_workflow: CompiledStateGraph[McpState, Any, McpState, McpState],
) -> None:
    """处理场景刷新指令

    遍历所有场景代理,更新它们的故事描述与环境描述。

    Args:
        stage_agents: 场景代理列表
        current_agent: 当前激活的代理
        llm: DeepSeek LLM 实例
        mcp_client: MCP 客户端实例
        available_tools: 可用的工具列表
        mcp_workflow: MCP 工作流状态图
    """
    # for stage_agent in stage_agents:
    logger.info(f"🔄 更新场景代理: {stage_agent.name}")

    stage_refresh_prompt = """请执行以下任务:

1. 查询场景内所有角色的当前状态(位置、行为、状态效果)
2. 基于角色的最新状态,更新场景的故事描述
3. 更新场景的环境描述(氛围、光线、声音、气味等感官细节)

要求:
- 环境描述要与当前剧情氛围相符
- 使用第三人称叙事视角
- 保持描述简洁生动,不超过200字"""

    # 执行 MCP 工作流
    response = await execute_mcp_state_workflow(
        user_input_state={
            "messages": [HumanMessage(content=stage_refresh_prompt)],
            "llm": llm,
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        },
        chat_history_state={
            "messages": stage_agent.chat_history.copy(),
            "llm": llm,
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        },
        work_flow=mcp_workflow,
    )

    # 更新场景代理的对话历史
    stage_agent.chat_history.append(HumanMessage(content=stage_refresh_prompt))
    stage_agent.chat_history.extend(response)


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_actor_observe(
    actor_agents: List[GameAgent],
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理角色观察指令

    让所有角色代理从第一人称视角观察当前场景,并更新各自的认知。

    Args:
        actor_agents: 角色代理列表
        stage_agent: 场景代理(提供场景上下文)
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    for actor_agent in actor_agents:
        logger.info(f"👀 角色观察场景: {actor_agent.name}")

        # 构建场景代理为特定角色生成观察描述的提示词
        observation_prompt = f"""请从 {actor_agent.name} 的视角,生成他在当前场景中的观察结果。

【场景任务】
1. 分析 {actor_agent.name} 的感知能力(视觉、听觉、嗅觉、触觉、魔法感知等)
2. 评估他的当前状态效果(是否失明、耳聋、被魅惑、警觉等)
3. 判断他与场景中其他角色/物体的位置关系和视线遮挡
4. 基于以上因素,生成他能感知到的信息

【输出要求】
- 使用第一人称视角输出: "我看到/听到/感觉到..."
- 只包含 {actor_agent.name} 实际能感知到的内容
- 对于其他角色,只描述可观察特征(外观、动作、神态),不要提及名字
- 被隐藏、遮挡或超出感知范围的事物不要描述
- 控制在100字以内,突出最关键的观察信息

注意: 不同角色在同一场景中观察到的内容应该有差异,体现各自的感知特点和关注重点。"""

        # 执行聊天工作流，使用场景代理的历史作为上下文
        response = execute_chat_state_workflow(
            user_input_state={
                "messages": [HumanMessage(content=observation_prompt)],
                "llm": llm,
            },
            chat_history_state={
                "messages": stage_agent.chat_history.copy(),
                "llm": llm,
            },
            work_flow=chat_workflow,
        )

        # 更新角色代理的对话历史
        # 注意: 这里是场景代理计算后的观察结果,但要让角色代理认为是自己主动观察到的
        actor_record = f"我仔细观察周围的环境和其他存在"
        actor_agent.chat_history.append(HumanMessage(content=actor_record))
        actor_agent.chat_history.extend(response)


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
    llm: ChatDeepSeek,
    mcp_client: McpClient,
    available_tools: List[McpToolInfo],
    available_prompts: List[McpPromptInfo],
    available_resources: List[McpResourceInfo],
    mcp_workflow: CompiledStateGraph[McpState, Any, McpState, McpState],
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
    rag_workflow: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    game_retriever: GameDocumentRetriever,
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

    # /game stage:refresh - 刷新所有场景代理的状态
    if command == "stage:refresh":
        assert len(stage_agents) > 0, "没有可用的场景代理进行刷新"
        await _handle_stage_refresh(
            stage_agent=stage_agents[0],
            llm=llm,
            mcp_client=mcp_client,
            available_tools=available_tools,
            mcp_workflow=mcp_workflow,
        )

    # /game actor:observe - 让所有角色观察并记录场景信息
    elif command == "actor:observe":
        assert len(stage_agents) > 0, "没有可用的场景代理"
        assert len(actor_agents) > 0, "没有可用的角色代理"

        await _handle_actor_observe(
            actor_agents=actor_agents,
            stage_agent=stage_agents[0],
            llm=llm,
            chat_workflow=chat_workflow,
        )

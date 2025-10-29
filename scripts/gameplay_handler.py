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

    logger.info(f"🔄 更新场景代理: {stage_agent.name}")

    stage_refresh_prompt = """# 场景状态更新

请查询场景内所有角色的当前状态(位置、行为、状态效果),并更新场景描述:

1. 故事层面:基于角色最新状态更新叙事
2. 感官层面:氛围、光线、声音、气味等环境描写
3. 如果有角色处于隐藏状态,请明确提出该角色为"隐藏"状态

**输出**: 第三人称视角,150字以内完整自然段,避免重复旧内容。"""

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
async def _handle_single_actor_observe(
    actor_agent: GameAgent,
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理单个角色观察指令

    让单个角色代理从第一人称视角观察当前场景,并更新其认知。

    Args:
        actor_agent: 角色代理
        stage_agent: 场景代理(提供场景上下文)
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    last_ai_message = stage_agent.chat_history[-1].content

    logger.info(f"👀 角色观察场景: {actor_agent.name}")

    # 构建观察提示词
    observation_prompt = f"""# 场景观察

{last_ai_message}

从你的第一人称视角观察并描述场景:你看到、听到、感受到什么?场景中有谁在做什么?你的情绪反应?

**隐藏规则**: 标注"隐藏/藏身/纹丝不动/无法被察觉"的角色对你来讲不存在（即使场景描述中提到），你不得以任何形式提及或暗示。

**输出**: 第一人称"我",100字以内,符合角色设定。"""

    # 执行聊天工作流，使用场景代理的历史作为上下文
    response = execute_chat_state_workflow(
        user_input_state={
            "messages": [HumanMessage(content=observation_prompt)],
            "llm": llm,
        },
        chat_history_state={
            "messages": actor_agent.chat_history.copy(),
            "llm": llm,
        },
        work_flow=chat_workflow,
    )

    # 更新角色代理的对话历史
    actor_observation_action = "我仔细观察周围的环境和其他存在"
    actor_agent.chat_history.append(HumanMessage(content=actor_observation_action))
    actor_agent.chat_history.extend(response)

    logger.debug(f"✅ {actor_agent.name} 完成场景观察")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_all_actors_observe(
    actor_agents: List[GameAgent],
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理所有角色观察指令

    让所有角色代理从第一人称视角观察当前场景,并更新各自的认知。

    Args:
        actor_agents: 角色代理列表
        stage_agent: 场景代理(提供场景上下文)
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    logger.debug(f"🏞️ 场景最新描述: {stage_agent.chat_history[-1].content}")

    for actor_agent in actor_agents:
        await _handle_single_actor_observe(
            actor_agent=actor_agent,
            stage_agent=stage_agent,
            llm=llm,
            chat_workflow=chat_workflow,
        )


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

    assert len(stage_agents) > 0, "没有可用的场景代理"
    assert len(actor_agents) > 0, "没有可用的角色代理"

    match command:  # /game stage:refresh - 刷新所有场景代理的状态
        case "stage:refresh":

            await _handle_stage_refresh(
                stage_agent=stage_agents[0],
                llm=llm,
                mcp_client=mcp_client,
                available_tools=available_tools,
                mcp_workflow=mcp_workflow,
            )

        # /game all_actors:observe - 让所有角色代理观察当前场景
        case "all_actors:observe":

            await _handle_all_actors_observe(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game pipeline:test1 - 测试流水线1: 刷新场景后让角色观察
        case "pipeline:test1":

            await _handle_stage_refresh(
                stage_agent=stage_agents[0],
                llm=llm,
                mcp_client=mcp_client,
                available_tools=available_tools,
                mcp_workflow=mcp_workflow,
            )

            await _handle_all_actors_observe(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=llm,
                chat_workflow=chat_workflow,
            )

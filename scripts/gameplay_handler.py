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
    actor_agent.chat_history.append(HumanMessage(content=observation_prompt))
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


async def _handle_actor_plan_all(
    actor_agents: List[GameAgent],
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理所有角色行动规划指令

    遍历所有角色代理,让每个角色基于观察结果规划下一步行动。

    Args:
        actor_agents: 角色代理列表
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    assert len(actor_agents) > 0, "没有可用的角色代理"

    # 遍历所有角色,依次执行行动规划
    for actor_agent in actor_agents:
        await _execute_actor_plan(
            actor_agent=actor_agent,
            llm=llm,
            chat_workflow=chat_workflow,
        )


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _execute_actor_plan(
    actor_agent: GameAgent,
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """执行单个角色的行动规划

    让指定角色基于其观察历史规划下一步行动。

    Args:
        actor_agent: 要规划行动的角色代理
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    logger.info(f"💬 角色行动计划: {actor_agent.name}")

    # 构建行动规划提示词
    action_planning_prompt = """# 行动规划

基于你的观察,规划下一步行动。可选类型:移动/交流/观察/互动/隐藏/其他。

**输出**(100字内,第一人称): 具体描述你将采取的行动、对象和目的,符合你的角色设定和当前情境。"""

    # 执行聊天工作流，使用角色代理自己的历史作为上下文
    response = execute_chat_state_workflow(
        user_input_state={
            "messages": [HumanMessage(content=action_planning_prompt)],
            "llm": llm,
        },
        chat_history_state={
            "messages": actor_agent.chat_history.copy(),
            "llm": llm,
        },
        work_flow=chat_workflow,
    )

    # 更新角色代理的对话历史
    actor_planning_action = f"我({actor_agent.name})思考接下来要采取的行动"
    actor_agent.chat_history.append(HumanMessage(content=actor_planning_action))
    actor_agent.chat_history.extend(response)

    logger.debug(f"✅ {actor_agent.name} 完成行动规划")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_stage_execute(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理场景执行指令

    收集所有角色的行动计划,由场景代理生成统一的行动执行描述。

    Args:
        stage_agent: 场景代理
        actor_agents: 角色代理列表
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    assert len(actor_agents) > 0, "没有可用的角色代理"

    logger.info(f"🎬 场景执行: {stage_agent.name}")

    # 收集所有角色的最后一个消息（行动计划）
    actor_plans = []
    for actor_agent in actor_agents:
        if len(actor_agent.chat_history) > 0:
            last_message = actor_agent.chat_history[-1]
            # 提取消息内容
            plan_content = (
                last_message.content
                if hasattr(last_message, "content")
                else str(last_message)
            )
            actor_plans.append({"actor_name": actor_agent.name, "plan": plan_content})

    if not actor_plans:
        logger.warning("⚠️  没有角色有行动计划，跳过场景执行")
        return

    # 构建行动执行提示词
    plans_text = "\n".join(
        [f"- **{plan['actor_name']}**: {plan['plan']}" for plan in actor_plans]
    )

    stage_execute_prompt = f"""# 场景行动执行

## 角色计划
{plans_text}

将上述计划转化为第三人称全知视角的场景执行描述:按时间顺序叙述各角色行动的实际过程、互动效果、环境变化。如有冲突需合理描述结果。

**输出**(200字内): 生动具体的完整自然段,展现执行效果而非重复计划。"""

    # 执行 Chat 工作流
    response = execute_chat_state_workflow(
        user_input_state={
            "messages": [HumanMessage(content=stage_execute_prompt)],
            "llm": llm,
        },
        chat_history_state={
            "messages": stage_agent.chat_history.copy(),
            "llm": llm,
        },
        work_flow=chat_workflow,
    )

    # 更新场景代理的对话历史
    stage_agent.chat_history.append(HumanMessage(content=stage_execute_prompt))
    stage_agent.chat_history.extend(response)

    logger.debug(f"✅ 场景执行完成")


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

    match command:

        # /game stage:refresh - 刷新所有场景代理的状态
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

        # /game all_actors:plan - 让所有角色代理规划下一步行动
        case "all_actors:plan":

            await _handle_actor_plan_all(
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game stage:execute - 让场景代理执行所有角色的行动计划
        case "stage:execute":

            await _handle_stage_execute(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
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

            await _handle_actor_plan_all(
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

            await _handle_stage_execute(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

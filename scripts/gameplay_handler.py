#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

from typing import Dict, List, Any
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
async def _handle_stage_update(
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

    stage_update_prompt = """# 场景状态更新任务

## 核心要求

查询所有角色的当前状态,生成客观的场景快照描述。

## 重要约束

- **避免重复**: 不要重复历史记录中的内容,专注于描述当前最新状态
- **禁止重复上一次"场景行动执行"的内容**

## 内容要求

**必须包含**: 角色位置(方位/距离) | 外显动作(站立/移动/静止) | 隐藏状态标注【隐藏】 | 环境感官(光线/声音/气味)

**严格禁止**: ❌ 推断意图/目的/情绪 | ❌ 使用"似乎/打算/准备/试图/可能"等暗示词 | ❌ 主观解读

## 输出规范

第三人称全知视角 | 150字内 | 只写"是什么"不写"将做什么" | 客观简洁具体"""

    # 执行 MCP 工作流
    scene_update_response = await execute_mcp_state_workflow(
        user_input_state={
            "messages": [HumanMessage(content=stage_update_prompt)],
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
    stage_agent.chat_history.append(HumanMessage(content=stage_update_prompt))
    stage_agent.chat_history.extend(scene_update_response)


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

    logger.warning(f"角色观察场景: {actor_agent.name}")

    # 构建观察提示词
    observation_prompt = f"""# 场景观察

## 最新场景快照

{last_ai_message}

从你的第一人称视角观察并描述场景:你看到、听到、感受到什么?场景中有谁在做什么?你的情绪反应?

**隐藏规则**: 标注"隐藏/藏身/纹丝不动/无法被察觉"的角色对你来讲不存在（即使场景描述中提到），你不得以任何形式提及或暗示。

**输出**: 第一人称"我",100字以内,符合角色设定。"""

    # 执行聊天工作流，使用场景代理的历史作为上下文
    observation_response = execute_chat_state_workflow(
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
    actor_agent.chat_history.extend(observation_response)

    # logger.debug(f"✅ {actor_agent.name} 完成场景观察")


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
    logger.warning(f"角色行动计划: {actor_agent.name}")

    # 构建行动规划提示词
    action_planning_prompt = """# 行动规划

基于你的观察,规划下一步行动。可选类型:移动/交流/观察/互动/隐藏/其他。

**输出**(100字内,第一人称): 具体描述你将采取的行动、对象和目的,符合你的角色设定和当前情境。"""

    # 执行聊天工作流，使用角色代理自己的历史作为上下文
    action_plan_response = execute_chat_state_workflow(
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
    actor_agent.chat_history.extend(action_plan_response)

    # logger.debug(f"✅ {actor_agent.name} 完成行动规划")


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _collect_actor_plans(actor_agents: List[GameAgent]) -> List[Dict[str, str]]:
    """收集所有角色的行动计划

    从角色代理列表中提取每个角色的最后一条消息作为行动计划。

    Args:
        actor_agents: 角色代理列表

    Returns:
        包含角色名称和行动计划的字典列表,格式为 [{"actor_name": str, "plan": str}, ...]
    """
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
            actor_plans.append(
                {"actor_name": actor_agent.name, "plan": str(plan_content)}
            )
    return actor_plans


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _notify_actors_with_execution_result(
    actor_agents: List[GameAgent], stage_execution_response: List[Any]
) -> None:
    """将场景执行结果通知给所有角色代理

    从场景执行响应中提取结果,并将其作为事件通知发送给所有角色代理的对话历史。

    Args:
        actor_agents: 角色代理列表
        stage_execution_response: 场景执行工作流的响应结果
    """
    # 提取场景执行结果
    execution_result = (
        stage_execution_response[-1].content if stage_execution_response else ""
    )

    # 将场景执行结果通知给所有角色代理
    for actor_agent in actor_agents:
        # 构建场景执行结果通知提示词
        event_notification = f"""# 发生场景事件！

## 事件内容

{execution_result}

## 注意

以上是刚刚发生的场景事件,你需要了解这些信息以便做出后续反应。"""

        actor_agent.chat_history.append(HumanMessage(content=event_notification))


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

    # 收集所有角色的行动计划
    actor_plans = _collect_actor_plans(actor_agents)

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
    stage_execution_response = execute_chat_state_workflow(
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
    stage_agent.chat_history.extend(stage_execution_response)

    # logger.debug(f"✅ 场景执行完成")

    # 将场景执行结果通知给所有角色代理
    _notify_actors_with_execution_result(actor_agents, stage_execution_response)


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

        # /game stage:update - 更新所有场景代理的状态
        case "stage:update":

            await _handle_stage_update(
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

            await _handle_stage_update(
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

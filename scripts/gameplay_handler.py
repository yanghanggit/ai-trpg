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
from magic_book.demo.test_world import demo_world
import random


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
- 输出保持描述简洁生动，150字以内的完整自然段
- 避免重复之前的描述内容"""

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
def _collect_actor_perception_info(
    actor_agent: GameAgent,
) -> tuple[List[str], List[str], int] | None:
    """收集角色感知信息

    查找角色在世界中的位置,收集场景中其他角色的信息,用于生成观察提示词。

    Args:
        actor_agent: 角色代理

    Returns:
        如果成功: (其他角色名列表, 认识的角色名列表, 陌生角色数量)
        如果失败: None
    """
    # 查找角色在世界中的位置
    target_actor, target_stage = demo_world.find_actor_with_stage(
        actor_name=actor_agent.name,
    )

    if target_actor is None or target_stage is None:
        logger.error(
            f"⚠️  跳过角色 {actor_agent.name}: "
            f"{'未找到角色实例' if target_actor is None else '未找到所在场景'}"
        )
        return None

    # 收集场景中的其他角色信息
    other_actors_on_stage = [
        a.name for a in target_stage.actors if a.name != actor_agent.name
    ]
    known_actors = [
        name for name in other_actors_on_stage if name in target_actor.known_actors
    ]
    unknown_actors_count = len(other_actors_on_stage) - len(known_actors)

    return other_actors_on_stage, known_actors, unknown_actors_count


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

        # 收集角色感知信息
        perception_info = _collect_actor_perception_info(actor_agent)
        if perception_info is None:
            continue

        other_actors_on_stage, known_actors, unknown_actors_count = perception_info

        # 构建观察提示词
        observation_prompt = f"""# 以 {actor_agent.name} 的第一人称视角,生成他在当前场景中的纯感官观察结果。

【角色感知信息】
- 场景中共有 {len(other_actors_on_stage)} 个其他角色
- 认识的角色: {', '.join(known_actors) if known_actors else '无'}
- 陌生的角色数量: {unknown_actors_count} 个

【观察内容】
1. 场景环境: 建筑、地形、物体的位置、形态、颜色、材质
2. 感官信息: 光线强度/颜色、声音类型/方向、气味种类、温度/湿度
3. 其他角色: 外观特征、当前动作、身体姿态、位置关系

【禁止规则 - 必须严格遵守】
1. 禁止情绪词: 不使用"该死的"、"可怕的"、"美丽的"、"诡异的"等任何主观评价词
2. 禁止比喻修辞: 不使用"像...一样"、"仿佛"、"似乎"等比喻和拟人手法
3. 禁止推测: 不推测动机、情绪、意图,只描述可直接观察到的事实
4. 禁止评价: 不进行好坏、美丑、善恶等任何价值判断
5. 隐藏角色: 处于"隐藏"状态的角色必须完全忽略,不得以任何形式提及

【输出要求】
- 视角: 第一人称
- 风格: 客观、直接、精确
- 长度: 150字以内的完整自然段

重要提醒: 这是传感器式的数据采集,不是文学描写。{actor_agent.name} 的个性应在后续的行动和对话中体现,而非观察阶段。"""

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
        actor_observation_action = "我仔细观察周围的环境和其他存在"
        actor_agent.chat_history.append(HumanMessage(content=actor_observation_action))
        actor_agent.chat_history.extend(response)

        logger.debug(f"✅ {actor_agent.name} 完成场景观察")


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
    action_planning_prompt = """# 请以你的第一人称视角,规划你接下来"将要"采取的行动。

## 规划流程

基于你刚才的观察,在内心进行以下思考(不需要输出):
1. 回顾你观察到的关键信息(环境、角色、异常情况等)
2. 明确你当前最重要的短期目标
3. 选择最符合目标和情境的下一步行动

## 可选行动类型

- 移动: 前往某个位置或靠近/远离某个角色
- 交流: 与某个角色对话、打招呼、询问信息
- 观察: 继续观察特定对象或等待事态发展
- 互动: 与环境中的物体或机关互动
- 隐藏: 躲避视线或隐匿行踪
- 其他: 符合你的身份和当前情境的任何合理行动

## 输出格式

直接输出你计划采取的具体行动(100字以内):

**计划行动**: [描述具体的行动内容,包括动作、对象、目的。使用第一人称,展现你的决策思考]

## 注意事项
- 行动必须符合你的角色设定和当前身体状态
- 考虑环境因素(光线、声音、其他角色的位置)
- 如果有紧急情况或威胁,优先应对
- 保持简洁明确,避免模糊的表述"""

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
async def _handle_actor_plan_random(
    actor_agents: List[GameAgent],
    llm: ChatDeepSeek,
    chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理随机角色行动规划指令

    从角色列表中随机选择一个角色,让其基于观察结果规划下一步行动。

    Args:
        actor_agents: 角色代理列表
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    assert len(actor_agents) > 0, "没有可用的角色代理"

    # 随机选择一个角色
    actor_agent = random.choice(actor_agents)

    # 执行该角色的行动规划
    await _execute_actor_plan(
        actor_agent=actor_agent,
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

    stage_execute_prompt = f"""请基于以下角色的行动计划,生成第三人称的场景行动执行描述。

## 角色行动计划

{plans_text}

## 执行要求

1. 使用第三人称全知视角叙述
2. 按时间顺序描述各角色行动的实际执行过程
3. 描述行动之间的互动和影响(如果有)
4. 包含环境的动态变化和氛围渲染
5. 如果行动之间存在冲突或碰撞,合理描述结果

## 输出要求

- 视角: 第三人称全知
- 风格: 生动、具体、动态
- 长度: 200字以内的完整自然段
- 重点: 展现行动的实际执行效果,而非重复计划内容

注意: 这是行动的实际执行阶段,需要将计划转化为具体的场景描述,推进故事发展。"""

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

    match command:
        # /game stage:refresh - 刷新所有场景代理的状态
        case "stage:refresh":
            assert len(stage_agents) > 0, "没有可用的场景代理进行刷新"
            await _handle_stage_refresh(
                stage_agent=stage_agents[0],
                llm=llm,
                mcp_client=mcp_client,
                available_tools=available_tools,
                mcp_workflow=mcp_workflow,
            )

        # /game actor:observe - 让所有角色观察并记录场景信息
        case "actor:observe":
            assert len(stage_agents) > 0, "没有可用的场景代理"
            assert len(actor_agents) > 0, "没有可用的角色代理"

            await _handle_actor_observe(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game actor:plan:random - 随机选择一个角色规划行动
        case "actor:plan:random":
            await _handle_actor_plan_random(
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game actor:plan:all - 让所有角色规划行动
        case "actor:plan:all":
            await _handle_actor_plan_all(
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game stage:execute - 执行所有角色的行动计划并更新场景状态
        case "stage:execute":
            assert len(stage_agents) > 0, "没有可用的场景代理进行执行"
            await _handle_stage_execute(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=llm,
                chat_workflow=chat_workflow,
            )

        # /game pipeline:test1 - 上面两个步骤的组合测试。
        case "pipeline:test1":

            await _handle_stage_refresh(
                stage_agent=stage_agents[0],
                llm=llm,
                mcp_client=mcp_client,
                available_tools=available_tools,
                mcp_workflow=mcp_workflow,
            )

            await _handle_actor_observe(
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

        case _:
            logger.error(f"未知的游戏指令: {command}")

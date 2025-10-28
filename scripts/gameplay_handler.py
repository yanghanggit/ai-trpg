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
- 视角: 第一人称 ("我看到/听到/闻到...")
- 风格: 客观、直接、精确
- 长度: 100字以内，要一整段话
- 格式示例:
  ✅ 正确: "我看到藤蔓缠绕在墓碑上,藤蔓在微风中轻微摆动"
  ❌ 错误: "我看到那些该死的藤蔓像蛇一样缠绕在墓碑上,诡异地蠕动着"
  ✅ 正确: "我看到一个身穿黑色长袍的人站在雕像旁,他右手握着斧头"
  ❌ 错误: "我看到一个穿黑袍的家伙,看起来很危险,正紧张地握着斧头"

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

        case _:
            logger.error(f"未知的游戏指令: {command}")

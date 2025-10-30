#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

from typing import List, Any
from loguru import logger
from langchain_deepseek import ChatDeepSeek
from pydantic import BaseModel
from magic_book.deepseek import create_deepseek_llm
from magic_book.mcp import McpClient, McpToolInfo, McpPromptInfo, McpResourceInfo
from magic_book.utils.json_format import strip_json_code_block
from agent_utils import GameAgent
from workflow_executors import (
    execute_mcp_state_workflow,
    execute_chat_state_workflow,
)
from langchain.schema import HumanMessage, AIMessage


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorObservationAndPlan(BaseModel):
    """角色观察和行动计划的数据模型

    用于验证和解析角色的观察和行动计划JSON数据。
    """

    observation: str
    plan: str


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorPlan(BaseModel):
    """角色行动计划数据模型

    用于收集和传递角色的行动计划信息，提供类型安全的数据结构。
    """

    actor_name: str
    plan: str


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_stage_update(
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    mcp_client: McpClient,
    available_tools: List[McpToolInfo],
    # mcp_workflow: CompiledStateGraph[McpState, Any, McpState, McpState],
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
        # work_flow=mcp_workflow,
    )

    # 更新场景代理的对话历史
    stage_agent.chat_history.append(HumanMessage(content=stage_update_prompt))
    stage_agent.chat_history.extend(scene_update_response)


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_all_actors_observe_and_plan(
    actor_agents: List[GameAgent],
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    # chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
) -> None:
    """处理所有角色的观察和行动规划（合并版本，JSON输出）

    让每个角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        actor_agents: 角色代理列表
        stage_agent: 场景代理(提供场景上下文)
        llm: DeepSeek LLM 实例
        chat_workflow: Chat 工作流状态图
    """
    latest_stage_message = stage_agent.chat_history[-1].content

    for actor_agent in actor_agents:
        logger.warning(f"角色观察并规划: {actor_agent.name}")

        # JSON格式的提示词
        observe_and_plan_prompt = f"""# 场景观察与行动规划

## 最新场景快照

{latest_stage_message}

请完成以下两个任务：

### 任务1: 观察场景

从你的第一人称视角观察并描述场景：你看到、听到、感受到什么？场景中有谁在做什么？你的情绪反应？

**隐藏规则**: 标注"隐藏/藏身/纹丝不动/无法被察觉"的角色对你来讲不存在（即使场景描述中提到），你不得以任何形式提及或暗示。

### 任务2: 规划行动

基于你的观察，规划下一步行动。可选类型：移动/交流/观察/互动/隐藏/其他。

---

**输出格式**：

必须且只能返回JSON代码块格式，示例：

```json
{{
    "observation": "你的观察内容（第一人称'我'，约70字，符合角色设定）",
    "plan": "你的行动计划（第一人称'我'，约80字，具体描述行动、对象和目的）"
}}
```

**重要**: 只输出JSON代码块，不要有其他文本。"""

        # 执行聊天工作流
        actors_observe_and_plan_response = execute_chat_state_workflow(
            user_input_state={
                "messages": [HumanMessage(content=observe_and_plan_prompt)],
                "llm": llm,
            },
            chat_history_state={
                "messages": actor_agent.chat_history.copy(),
                "llm": llm,
            },
            # work_flow=chat_workflow,
        )

        # 更新角色代理的对话历史
        actor_agent.chat_history.append(HumanMessage(content=observe_and_plan_prompt))
        assert len(actors_observe_and_plan_response) > 0, "角色观察与规划响应为空"

        try:

            # 步骤1: 从JSON代码块中提取字符串
            json_str = strip_json_code_block(
                str(actors_observe_and_plan_response[-1].content)
            )

            # 步骤2: 使用Pydantic解析和验证
            formatted_data = ActorObservationAndPlan.model_validate_json(json_str)

            # 步骤3: 将结果添加到角色的对话历史
            actor_agent.chat_history.append(
                AIMessage(
                    content=f"""{formatted_data.observation}\n{formatted_data.plan}"""
                )
            )

        except Exception as e:
            logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _collect_actor_plans(actor_agents: List[GameAgent]) -> List[ActorPlan]:
    """收集所有角色的行动计划

    从角色代理列表中提取每个角色的最后一条消息作为行动计划。
    使用类型安全的ActorPlan模型返回数据。

    Args:
        actor_agents: 角色代理列表

    Returns:
        ActorPlan对象列表，每个对象包含actor_name和plan字段
    """
    actor_plans: List[ActorPlan] = []

    for actor_agent in actor_agents:
        if len(actor_agent.chat_history) > 0:
            last_message = actor_agent.chat_history[-1]
            # 提取消息内容并确保是字符串类型
            content = (
                last_message.content
                if hasattr(last_message, "content")
                else str(last_message)
            )
            # 确保content是字符串
            content_str = str(content) if not isinstance(content, str) else content

            actor_plans.append(
                ActorPlan(
                    actor_name=actor_agent.name,
                    plan=content_str,
                )
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
    # chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
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
    plans_text = "\n\n".join(
        [f"**{plan.actor_name}**: {plan.plan}" for plan in actor_plans]
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
        # work_flow=chat_workflow,
    )

    # 更新场景代理的对话历史
    stage_agent.chat_history.append(HumanMessage(content=stage_execute_prompt))
    stage_agent.chat_history.extend(stage_execution_response)

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
    # llm: ChatDeepSeek,
    mcp_client: McpClient,
    available_tools: List[McpToolInfo],
    available_prompts: List[McpPromptInfo],
    available_resources: List[McpResourceInfo],
    # mcp_workflow: CompiledStateGraph[McpState, Any, McpState, McpState],
    # chat_workflow: CompiledStateGraph[ChatState, Any, ChatState, ChatState],
    # rag_workflow: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    # game_retriever: GameDocumentRetriever,
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
                llm=create_deepseek_llm(),
                mcp_client=mcp_client,
                available_tools=available_tools,
                # mcp_workflow=mcp_workflow,
            )

        # /game all_actors:observe_and_plan - 让所有角色代理观察场景并规划行动
        case "all_actors:observe_and_plan":
            await _handle_all_actors_observe_and_plan(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=create_deepseek_llm(),
                # chat_workflow=chat_workflow,
            )

        # /game stage:execute - 让场景代理执行所有角色的行动计划
        case "stage:execute":

            await _handle_stage_execute(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=create_deepseek_llm(),
                # chat_workflow=chat_workflow,
            )

        # /game pipeline:test1 - 测试流水线1: 刷新场景后让角色观察
        case "pipeline:test1":

            await _handle_stage_update(
                stage_agent=stage_agents[0],
                llm=create_deepseek_llm(),
                mcp_client=mcp_client,
                available_tools=available_tools,
                # mcp_workflow=mcp_workflow,
            )

            await _handle_all_actors_observe_and_plan(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=create_deepseek_llm(),
                # chat_workflow=chat_workflow,
            )

            await _handle_stage_execute(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=create_deepseek_llm(),
                # chat_workflow=chat_workflow,
            )

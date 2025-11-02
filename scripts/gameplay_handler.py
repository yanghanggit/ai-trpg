#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

import asyncio
from typing import List
from loguru import logger
from pydantic import BaseModel
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient, McpToolInfo
from ai_trpg.utils.json_format import strip_json_code_block
from agent_utils import GameAgent
from workflow_handlers import (
    handle_chat_workflow_execution,
)
from langchain.schema import HumanMessage, AIMessage


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorObservationAndPlan(BaseModel):
    """角色观察和行动计划的数据模型

    用于验证和解析角色的观察和行动计划JSON数据。
    """

    observation: str  # 角色观察内容
    plan: str  # 角色行动计划内容


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorPlan(BaseModel):
    """角色行动计划数据模型

    用于收集和传递角色的行动计划信息，提供类型安全的数据结构。
    """

    actor_name: str  # 角色名称
    plan: str  # 行动计划内容


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorState(BaseModel):
    """单个角色的状态数据模型

    用于描述角色在场景中的当前状态，包括位置、姿态和特殊状态标记。
    """

    actor_name: str
    location: str  # 位置（相对地标/方位/距离）
    posture: str  # 姿态
    status: str  # 状态（如"【隐藏】"或空字符串）


########################################################################################################################
########################################################################################################################
########################################################################################################################
class StageExecutionResult(BaseModel):
    """场景执行结果的数据模型

    用于验证和解析场景执行的JSON输出，包含叙事描述、角色状态和环境状态。
    """

    narrative: str  # 场景执行描述（叙事层）
    actor_states: List[ActorState]  # 角色状态列表
    environment_state: str  # 环境状态描述


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_single_actor_observe_and_plan(
    stage_agent: GameAgent,
    actor_agent: GameAgent,
    mcp_client: McpClient,
) -> None:
    """处理单个角色的观察和行动规划

    让角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        actor_agent: 角色代理
        mcp_client: MCP 客户端（用于读取角色信息资源）
    """
    logger.warning(f"角色观察并规划: {actor_agent.name}")

    # 读取角色信息资源
    try:
        actor_resource_uri = f"game://actor/{actor_agent.name}"
        actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
        if actor_resource_response is None or actor_resource_response.text is None:
            logger.error(f"❌ 未能读取资源: {actor_resource_uri}")
            return

        actor_info_json = actor_resource_response.text
        # logger.debug(f"读取到角色信息: {actor_info_json}")

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")
        return

    # 在这个位置获取场景stage 的 resource
    try:
        stage_resource_uri = f"game://stage/{stage_agent.name}"
        stage_resource_response = await mcp_client.read_resource(stage_resource_uri)
        if stage_resource_response is None or stage_resource_response.text is None:
            logger.error(f"❌ 未能读取资源: {stage_resource_uri}")
            return

        stage_info_json = stage_resource_response.text
        # logger.debug(f"读取到场景信息: {stage_info_json}")

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")
        return

    observe_and_plan_prompt = f"""# 角色观察与行动规划

## 第一步：你的角色信息 与 当前场景信息

```json
{actor_info_json}
```

```json
{stage_info_json}
```

---

## 第二步：观察场景

从第一人称（"我"）视角观察场景：

- **视觉**：环境、物体、其他角色的位置和行为
- **听觉**：声音、对话、环境音
- **其他感知**：触觉、嗅觉、情绪反应
- **状态评估**：结合上述角色属性，评估当前状况

**隐藏规则**：标注"隐藏/藏身/无法被察觉"的角色不可见，不得提及或暗示。

约70字，符合角色设定。

---

## 第三步：规划行动（基于观察结果）

基于观察，规划下一步行动：

- **行动类型**：移动/交流/观察/互动/隐藏/战斗/其他
- **具体内容**：做什么（动作）、针对谁/什么（对象）、为什么（目的）
- **可行性**：结合角色属性（生命值、攻击力）判断行动可行性

约80字，第一人称，具体且可执行。

---

## 输出格式

输出JSON：

```json
{{
    "observation": "步骤2的观察内容（第一人称，约70字，体现属性信息）",
    "plan": "步骤3的行动计划（第一人称，约80字，考虑属性可行性）"
}}
```

**要求**：基于第一步提供的角色信息 → 观察场景 → 规划行动 → 输出JSON"""

    actors_observe_and_plan_response = await handle_chat_workflow_execution(
        agent_name=actor_agent.name,
        context={
            "messages": actor_agent.context.copy(),
            "llm": create_deepseek_llm(),
        },
        request={
            "messages": [HumanMessage(content=observe_and_plan_prompt)],
            "llm": create_deepseek_llm(),
        },
    )

    # 更新角色代理的对话历史
    actor_agent.context.append(HumanMessage(content=observe_and_plan_prompt))
    assert len(actors_observe_and_plan_response) > 0, "角色观察与规划响应为空"

    try:
        # 步骤1: 从JSON代码块中提取字符串
        json_str = strip_json_code_block(
            str(actors_observe_and_plan_response[-1].content)
        )

        # 步骤2: 使用Pydantic解析和验证
        formatted_data = ActorObservationAndPlan.model_validate_json(json_str)

        # 步骤3: 将结果添加到角色的对话历史
        actor_agent.context.append(
            AIMessage(
                content=f"""{formatted_data.observation}\n{formatted_data.plan}"""
            )
        )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_all_actors_observe_and_plan(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
    use_concurrency: bool = False,
) -> None:
    """处理所有角色的观察和行动规划（合并版本，JSON输出）

    让每个角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端（用于读取角色信息资源）
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    if use_concurrency:
        # 并行处理所有角色
        logger.info(f"🔄 并行处理 {len(actor_agents)} 个角色的观察和规划")
        tasks = [
            _handle_single_actor_observe_and_plan(
                stage_agent=stage_agent,
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            for actor_agent in actor_agents
        ]
        await asyncio.gather(*tasks)
    else:
        # 顺序处理所有角色
        logger.info(f"🔄 顺序处理 {len(actor_agents)} 个角色的观察和规划")
        for actor_agent in actor_agents:
            await _handle_single_actor_observe_and_plan(
                stage_agent=stage_agent,
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )


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
        if len(actor_agent.context) > 0:
            last_message = actor_agent.context[-1]
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
    actor_agents: List[GameAgent], execution_result: StageExecutionResult
) -> None:
    """将场景执行结果通知给所有角色代理

    从场景执行结果中提取叙事描述和角色状态,并将其作为事件通知发送给所有角色代理的对话历史。

    Args:
        actor_agents: 角色代理列表
        execution_result: 场景执行结果的结构化数据
    """
    # 构建角色状态文本
    actor_states_text = "\n".join(
        [
            f"- **{state.actor_name}**：{state.location} | {state.posture} | {state.status}"
            for state in execution_result.actor_states
        ]
    )

    # 将场景执行结果通知给所有角色代理
    for actor_agent in actor_agents:
        # 构建场景执行结果通知提示词
        event_notification = f"""# 场景事件发生

## 事件叙事

{execution_result.narrative}

## 当前角色状态

{actor_states_text}

## 当前环境状态

{execution_result.environment_state}

---

**提示**：以上是刚刚发生的场景事件及最新状态快照，请基于这些信息进行观察和规划。"""

        actor_agent.context.append(HumanMessage(content=event_notification))


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _orchestrate_actor_plans_and_update_stage(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
    available_tools: List[McpToolInfo],
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

    stage_execute_prompt = f"""# 场景行动执行与状态更新

## 角色计划

{plans_text}

## 任务要求

基于上述角色计划，生成场景执行结果。

**输出格式**：

必须且只能返回JSON代码块格式，示例：

```json
{{
    "narrative": "第三人称全知视角的场景执行描述，按时间顺序叙述各角色行动的实际过程、互动效果、环境变化。如有冲突需合理描述结果。生动具体的完整自然段，展现执行效果而非重复计划。",
    "actor_states": [
        {{
            "actor_name": "角色名1",
            "location": "当前位置（相对地标/方位/距离）",
            "posture": "当前姿态",
            "status": "【隐藏】或空字符串"
        }},
        {{
            "actor_name": "角色名2",
            "location": "当前位置",
            "posture": "当前姿态",
            "status": ""
        }}
    ],
    "environment_state": "完整的环境描述段落。基于你对话历史中最近一次输出的environment_state进行更新。如果是第一轮执行，参考系统消息中的初始环境描述。保持未变化的部分不变（空间结构、固定设施、基本布局等），更新有变化的部分（物体损坏、地面痕迹、环境扰动、角色行动留痕等），添加新增的感官元素（新出现的气味、声音、视觉变化等）。这是完整的绝对描述，不是增量变化。"
}}
```

**重要**：

1. 只输出JSON代码块，不要有其他文本
2. narrative字段：生动叙事，展现执行过程
3. actor_states数组：必须包含所有角色的状态
4. environment_state字段：完整的环境快照，是下一轮场景更新的起点

**环境状态更新原则**：

- 第一轮：参考系统消息中的初始环境描述
- 后续轮次：从对话历史中找到上一次的environment_state，以此为基准更新
- 保持未变化部分，更新有变化部分，添加新增感官元素
- 输出完整描述，非增量描述"""

    # 执行 Chat 工作流
    stage_execution_response = await handle_chat_workflow_execution(
        agent_name=stage_agent.name,
        request={
            "messages": [HumanMessage(content=stage_execute_prompt)],
            "llm": create_deepseek_llm(),
        },
        context={
            "messages": stage_agent.context.copy(),
            "llm": create_deepseek_llm(),
        },
    )

    # 更新场景代理的对话历史
    stage_agent.context.append(HumanMessage(content=stage_execute_prompt))
    assert len(stage_execution_response) > 0, "场景执行响应为空"

    try:
        # 步骤1: 从JSON代码块中提取字符串
        json_str = strip_json_code_block(str(stage_execution_response[-1].content))

        # 步骤2: 使用Pydantic解析和验证
        formatted_data = StageExecutionResult.model_validate_json(json_str)

        # 步骤3: 构建格式化的消息添加到对话历史
        actor_states_text = "\n".join(
            [
                f"- **{state.actor_name}**：{state.location} | {state.posture} | {state.status}"
                for state in formatted_data.actor_states
            ]
        )

        formatted_content = f"""## 场景执行

{formatted_data.narrative}

---

## 状态快照

### 角色状态

{actor_states_text}

### 环境状态

{formatted_data.environment_state}"""

        stage_agent.context.append(AIMessage(content=formatted_content))

        logger.success(f"✅ 场景执行成功: {stage_agent.name}")

        # 将场景执行结果通知给所有角色代理
        _notify_actors_with_execution_result(actor_agents, formatted_data)

        # 随便测试下调用 MCP 同步场景状态工具
        await mcp_client.call_tool(
            "sync_stage_state",
            {
                "stage_name": stage_agent.name,
                "state_data": json_str,  # 参数名也改了
            },
        )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


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
    # available_tools: List[McpToolInfo],
    # available_prompts: List[McpPromptInfo],
    # available_resources: List[McpResourceInfo],
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

        # /game all_actors:observe_and_plan - 让所有角色代理观察场景并规划行动
        case "all_actors:observe_and_plan":
            await _handle_all_actors_observe_and_plan(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

        # /game stage:orchestrate_actor_plans_and_update_stage - 让场景代理执行所有角色的行动计划
        case "stage:orchestrate_actor_plans_and_update_stage":

            await _orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                available_tools=available_tools,
            )

        # /game pipeline:test1 - 测试流水线1: 观察规划→执行更新循环
        # 注意: 假设第0帧 已通过初始化注入stage_agent
        case "pipeline:test1":

            # 步骤1: 所有角色观察场景并规划行动
            await _handle_all_actors_observe_and_plan(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                use_concurrency=True,
            )

            # 步骤2: 场景执行计划并生成新的状态快照
            # 输出的状态快照将成为下一轮的输入
            await _orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                mcp_client=mcp_client,
                available_tools=available_tools,
            )

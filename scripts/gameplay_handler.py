#!/usr/bin/env python3
"""
游戏玩法处理器模块

提供游戏玩法相关的功能处理，包括游戏指令的执行和处理。
"""

import asyncio
from typing import List
from loguru import logger
from langchain_deepseek import ChatDeepSeek
from pydantic import BaseModel
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient, McpToolInfo, McpPromptInfo, McpResourceInfo
from ai_trpg.utils.json_format import strip_json_code_block
from agent_utils import GameAgent
from workflow_executors import (
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
    actor_agent: GameAgent,
    llm: ChatDeepSeek,
) -> None:
    """处理单个角色的观察和行动规划

    让角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        actor_agent: 角色代理
        latest_stage_message: 最新的场景消息内容
        llm: DeepSeek LLM 实例
    """
    logger.warning(f"角色观察并规划: {actor_agent.name}")

    # JSON格式的提示词
    observe_and_plan_prompt = f"""# 场景观察与行动规划

## 请完成以下两个任务：

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
    actors_observe_and_plan_response = await execute_chat_state_workflow(
        request={
            "messages": [HumanMessage(content=observe_and_plan_prompt)],
            "llm": llm,
        },
        context={
            "messages": actor_agent.chat_history.copy(),
            "llm": llm,
        },
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
        logger.success(
            f"{actor_agent.name}:\n{formatted_data.observation}\n{formatted_data.plan}"
        )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_all_actors_observe_and_plan(
    actor_agents: List[GameAgent],
    stage_agent: GameAgent,
    llm: ChatDeepSeek,
    use_concurrency: bool = False,
) -> None:
    """处理所有角色的观察和行动规划（合并版本，JSON输出）

    让每个角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        actor_agents: 角色代理列表
        stage_agent: 场景代理(提供场景上下文)
        llm: DeepSeek LLM 实例
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    if use_concurrency:
        # 并行处理所有角色
        logger.info(f"🔄 并行处理 {len(actor_agents)} 个角色的观察和规划")
        tasks = [
            _handle_single_actor_observe_and_plan(
                actor_agent=actor_agent,
                llm=llm,
            )
            for actor_agent in actor_agents
        ]
        await asyncio.gather(*tasks)
    else:
        # 顺序处理所有角色
        logger.info(f"🔄 顺序处理 {len(actor_agents)} 个角色的观察和规划")
        for actor_agent in actor_agents:
            await _handle_single_actor_observe_and_plan(
                actor_agent=actor_agent,
                llm=llm,
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

        actor_agent.chat_history.append(HumanMessage(content=event_notification))


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _orchestrate_actor_plans_and_update_stage(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    llm: ChatDeepSeek,
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
    stage_execution_response = await execute_chat_state_workflow(
        request={
            "messages": [HumanMessage(content=stage_execute_prompt)],
            "llm": llm,
        },
        context={
            "messages": stage_agent.chat_history.copy(),
            "llm": llm,
        },
    )

    # 更新场景代理的对话历史
    stage_agent.chat_history.append(HumanMessage(content=stage_execute_prompt))
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

        stage_agent.chat_history.append(AIMessage(content=formatted_content))

        logger.success(f"✅ 场景执行成功: {stage_agent.name}")

        # 将场景执行结果通知给所有角色代理
        _notify_actors_with_execution_result(actor_agents, formatted_data)

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
    available_tools: List[McpToolInfo],
    available_prompts: List[McpPromptInfo],
    available_resources: List[McpResourceInfo],
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

        # /game all_actors:observe_and_plan - 让所有角色代理观察场景并规划行动
        case "all_actors:observe_and_plan":
            await _handle_all_actors_observe_and_plan(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=create_deepseek_llm(),
                use_concurrency=False,
            )

        # /game stage:orchestrate_actor_plans_and_update_stage - 让场景代理执行所有角色的行动计划
        case "stage:orchestrate_actor_plans_and_update_stage":

            await _orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=create_deepseek_llm(),
            )

        # /game pipeline:test1 - 测试流水线1: 观察规划→执行更新循环
        # 注意: 假设第0帧 已通过初始化注入stage_agent
        case "pipeline:test1":

            # 步骤1: 所有角色观察场景并规划行动
            await _handle_all_actors_observe_and_plan(
                actor_agents=actor_agents,
                stage_agent=stage_agents[0],
                llm=create_deepseek_llm(),
                use_concurrency=True,
            )

            # 步骤2: 场景执行计划并生成新的状态快照
            # 输出的状态快照将成为下一轮的输入
            await _orchestrate_actor_plans_and_update_stage(
                stage_agent=stage_agents[0],
                actor_agents=actor_agents,
                llm=create_deepseek_llm(),
            )

#!/usr/bin/env python3
"""
游戏流水线 - 场景执行模块

负责编排角色计划并更新场景状态。
"""

import json
from typing import List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from ai_trpg.utils.json_format import strip_json_code_block
from agent_utils import GameAgent
from workflow_handlers import handle_chat_workflow_execution


def _gen_compressed_stage_execute_prompt(stage_name: str) -> str:

    return f"""# {stage_name} 场景发生事件！请生成事件内容！"""


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
    environment: str  # 环境状态描述


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _build_actor_plan_prompt(
    actor_agent: GameAgent, mcp_client: McpClient
) -> str:
    """构建角色计划提示词（优化版）

    生成格式：
    **角色名**
    - 行动计划: xxx
    - 战斗数据: 生命值 X/Y | 攻击力 Z
    - 状态效果: 效果1(描述), 效果2(描述) 或 无
    - 外观: xxx
    """

    if len(actor_agent.plans) == 0:
        return ""

    try:
        actor_resource_uri = f"game://actor/{actor_agent.name}"
        actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
        if actor_resource_response is None or actor_resource_response.text is None:
            logger.error(f"❌ 未能读取资源: {actor_resource_uri}")
            return ""

        # 解析角色数据
        actor_info = json.loads(actor_resource_response.text)

        # 提取基本信息
        name = actor_info.get("name", "未知")
        appearance = actor_info.get("appearance", "无描述")
        attributes = actor_info.get("attributes", {})
        effects = actor_info.get("effects", [])

        # 格式化属性
        health = attributes.get("health", 0)
        max_health = attributes.get("max_health", 0)
        attack = attributes.get("attack", 0)

        # 格式化效果（紧凑型，包含名称和描述）
        if effects:
            # 每个effect是一个dict，包含name和description
            effect_parts = []
            for effect in effects:
                effect_name = effect.get("name", "未知效果")
                effect_desc = effect.get("description", "")
                if effect_desc:
                    effect_parts.append(f"{effect_name}({effect_desc})")
                else:
                    effect_parts.append(effect_name)
            effects_str = ", ".join(effect_parts)
        else:
            effects_str = "无"

        # 构建美化后的提示词
        return f"""**{name}**
- 行动计划: {actor_agent.plans[-1]}
- 战斗数据: 生命值 {health}/{max_health} | 攻击力 {attack}
- 状态效果: {effects_str}
- 外观: {appearance}"""

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")

    return ""


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _collect_actor_plan_prompts(
    actor_agents: List[GameAgent], mcp_client: McpClient
) -> List[str]:
    """收集所有角色的行动计划

    从角色代理列表中提取每个角色的最后一条消息作为行动计划。
    使用类型安全的ActorPlan模型返回数据。

    Args:
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端

    Returns:
        角色计划提示词字符串列表
    """
    ret: List[str] = []

    for actor_agent in actor_agents:
        prompt = await _build_actor_plan_prompt(actor_agent, mcp_client)
        if prompt != "":
            ret.append(prompt)

    return ret


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def orchestrate_actor_plans_and_update_stage(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
) -> None:
    """处理场景执行指令

    收集所有角色的行动计划,由场景代理生成统一的行动执行描述。

    Args:
        stage_agent: 场景代理
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端
    """
    assert len(actor_agents) > 0, "没有可用的角色代理"

    logger.info(f"🎬 场景执行: {stage_agent.name}")

    stage_resource_uri = f"game://stage/{stage_agent.name}"
    stage_resource_response = await mcp_client.read_resource(stage_resource_uri)
    if stage_resource_response is None or stage_resource_response.text is None:
        logger.error(f"❌ 未能读取资源: {stage_resource_uri}")
        return

    # 收集所有角色的行动计划
    actor_plans = await _collect_actor_plan_prompts(actor_agents, mcp_client)

    stage_info_json = json.loads(stage_resource_response.text)

    if not actor_plans:
        logger.warning("⚠️  没有角色有行动计划，跳过场景执行")
        return

    # 构建行动执行提示词
    stage_execute_prompt = f"""# {stage_agent.name} 场景行动执行与状态更新

## 角色计划与信息

{"\n\n".join(actor_plans)}

## 角色状态

{stage_info_json.get("actor_states", "")}

## 当前环境

{stage_info_json.get("environment", "")}

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
    "environment": "完整的环境描述段落。基于你对话历史中最近一次输出的environment进行更新。如果是第一轮执行，参考系统消息中的初始环境描述。保持未变化的部分不变（空间结构、固定设施、基本布局等），更新有变化的部分（物体损坏、地面痕迹、环境扰动、角色行动留痕等），添加新增的感官元素（新出现的气味、声音、视觉变化等）。这是完整的绝对描述，不是增量变化。"
}}
```

**重要**：

1. 只输出JSON代码块，不要有其他文本
2. narrative字段：生动叙事，展现执行过程
3. actor_states数组：必须包含所有角色的状态
4. environment字段：完整的环境快照，是下一轮场景更新的起点

**环境状态更新原则**：

- 基准：使用上方'当前环境'部分提供的环境描述作为更新基准
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

    assert len(stage_execution_response) > 0, "场景执行响应为空"

    try:
        # 步骤1: 从JSON代码块中提取字符串
        json_str = strip_json_code_block(str(stage_execution_response[-1].content))

        # 步骤2: 使用Pydantic解析和验证
        formatted_data = StageExecutionResult.model_validate_json(json_str)

        # 步骤3: 更新场景代理的对话历史
        stage_agent.context.append(
            HumanMessage(content=_gen_compressed_stage_execute_prompt(stage_agent.name))
        )

        # 步骤4: 记录场景执行结果到场景代理的对话历史
        stage_agent.context.append(AIMessage(content=formatted_data.narrative))
        logger.debug(
            f"✅ 场景 {stage_agent.name} 执行结果 = \n{formatted_data.narrative}"
        )
        stage_agent.context.append(
            HumanMessage(
                content="**注意**！场景状态已更新，请在下轮执行中考虑这些变化。"
            )
        )

        # 步骤5: 通知所有角色代理场景执行结果
        for actor_agent in actor_agents:

            notify_prompt = f"""# {stage_agent.name} 场景发生事件：
            
## 叙事
{formatted_data.narrative}
            
以上事件已发生并改变了场景状态，这将直接影响你的下一步观察与规划。"""

            # 更新角色代理的对话历史
            actor_agent.context.append(HumanMessage(content=notify_prompt))
            logger.debug(
                f"✅ 角色 {actor_agent.name} 收到场景执行结果通知 = \n{notify_prompt}"
            )

        # 步骤？: 随便测试下调用 MCP 同步场景状态工具
        await mcp_client.call_tool(
            "sync_stage_state",
            {
                "stage_name": stage_agent.name,
                "state_data": json_str,  # 参数名也改了
            },
        )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")

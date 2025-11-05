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
from agent_utils import GameAgent
from workflow_handlers import (
    handle_mcp_workflow_execution,
)


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
    """场景执行结果的数据模型（完整版 - 用于内部验证）

    用于验证和解析场景执行的JSON输出，包含叙事描述、角色状态和环境状态。
    """

    calculation_log: str  # 计算过程日志（包含战斗计算、互动效果等）- 优先计算
    narrative: str  # 场景执行描述（叙事层）- 基于计算结果生成
    actor_states: List[ActorState]  # 角色状态列表
    environment: str  # 环境描述


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
    - 效果: 效果1(描述), 效果2(描述) 或 无
    - 外观: xxx
    """

    if actor_agent.plan == "":
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

- 行动计划: {actor_agent.plan}
- 战斗数据: 生命值 {health}/{max_health} | 攻击力 {attack}
- 效果: {effects_str}
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
async def handle_orchestrate_actor_plans_and_update_stage(
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

    # 构建行动执行提示词（MCP Workflow 版本）
    stage_execute_prompt = f"""# {stage_agent.name} 场景行动执行与状态更新

## 角色计划与信息

{"\n\n".join(actor_plans)}

## 角色状态

{stage_info_json.get("actor_states", "")}

## 当前环境

{stage_info_json.get("environment", "")}

## 执行流程（严格按顺序）

### 第一步：内部分析（不输出）

分析并准备以下数据：

1. **计算战斗或互动结果**（calculation_log）
   - 战斗场景：计算伤害（攻击力 + 效果加成），确定新生命值
   - 战斗公式：当前生命值 - 伤害 = 新生命值
   - 非战斗场景：分析互动过程和结果

2. **构建场景叙事**（narrative）
   - 第三人称描述各角色行动过程、互动效果、环境变化

3. **确定角色状态变化**（actor_states）
   - 格式：`**角色名**: 位置 | 姿态 | 状态`
   - 记录每个角色的新位置、姿态和特殊状态

4. **更新环境描述**（environment）
   - 保持未变化部分，更新有变化部分

---

### 第二步：调用工具保存状态（必须完成）

**🚨 这是唯一的任务：调用工具保存游戏状态**

完成第一步的内部分析后，你必须立即调用工具来保存状态变化。

#### 必须调用的工具

**1. 保存场景状态**（必须调用）
   - 同步 calculation_log（战斗计算日志）、narrative（场景叙事）、actor_states（角色状态）、environment（环境描述）
   - 无论场景是否变化，这个工具都必须调用

**2. 更新角色生命值**（如果有生命值变化）
   - 为每个生命值变化的角色调用工具
   - 传入新的生命值（整数，范围 0 到最大生命值）

**3. 移除失效效果**（如果有效果被触发或消耗）
   - 为每个需要移除的效果调用工具

**⚠️ 调用工具后，你可以返回任何简短的确认信息（例如："状态已更新"）**"""

    # 执行 MCP 工作流（改用支持工具调用的工作流）
    stage_execution_response = await handle_mcp_workflow_execution(
        agent_name=stage_agent.name,
        context=stage_agent.context.copy(),
        request=HumanMessage(content=stage_execute_prompt),
        llm=create_deepseek_llm(),
        mcp_client=mcp_client,  # 传入 MCP 客户端
    )

    assert len(stage_execution_response) > 0, "场景执行响应为空"

    try:
        # 步骤1: 从 MCP 资源重新读取 stage 数据以获取最新的 narrative
        stage_resource_response_updated = await mcp_client.read_resource(
            stage_resource_uri
        )
        if (
            stage_resource_response_updated is None
            or stage_resource_response_updated.text is None
        ):
            logger.error(f"❌ 未能读取更新后的资源: {stage_resource_uri}")
            return

        stage_info_updated = json.loads(stage_resource_response_updated.text)
        narrative = stage_info_updated.get("narrative", "")

        # 步骤2: 更新场景代理的对话历史（压缩提示词）
        stage_agent.context.append(
            HumanMessage(content=_gen_compressed_stage_execute_prompt(stage_agent.name))
        )

        # 步骤3: 记录场景执行结果到场景代理的对话历史
        stage_agent.context.append(AIMessage(content=narrative))
        logger.debug(f"✅ 场景 {stage_agent.name} 执行结果 = \n{narrative}")
        stage_agent.context.append(
            HumanMessage(content="**注意**！场景已更新，请在下轮执行中考虑这些变化。")
        )

        # 步骤4: 通知所有角色代理场景执行结果
        for actor_agent in actor_agents:

            notify_prompt = f"""# {stage_agent.name} 场景发生事件：
            
## 叙事
{narrative}
            
以上事件已发生并改变了场景状态，这将直接影响你的下一步观察与规划。"""

            # 更新角色代理的对话历史
            actor_agent.context.append(HumanMessage(content=notify_prompt))
            logger.debug(
                f"✅ 角色 {actor_agent.name} 收到场景执行结果通知 = \n{notify_prompt}"
            )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")

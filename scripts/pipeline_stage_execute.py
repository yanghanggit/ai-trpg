#!/usr/bin/env python3
"""
游戏流水线 - 场景执行模块

负责编排角色计划并更新场景状态。
"""

from typing import Any, Dict, List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from agent_utils import StageAgent, ActorAgent
from workflow_handlers import (
    handle_mcp_workflow_execution,
)
from ai_trpg.utils.json_format import strip_json_code_block
from mcp_client_resource_helpers import read_actor_resource, read_stage_resource


#
def _gen_compressed_stage_execute_prompt(stage_name: str, original_message: str) -> str:
    compressed_message = f"""# 指令！你（{stage_name}）场景发生事件！请输出事件内容！"""
    # logger.debug(f"{original_message}=>\n{compressed_message}")
    return compressed_message


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
class StageExecutionSummary(BaseModel):
    """场景执行总结的数据模型（用于二次推理指令输出）

    用于解析和验证步骤3的JSON输出，包含执行总结和工具调用列表。
    """

    summary: str  # 场景执行的简短总结（一句话）
    # tools_executed: List[str]  # 已执行的工具名称列表


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _build_actor_plan_prompt(
    actor_agent: ActorAgent, mcp_client: McpClient
) -> str:
    """构建角色计划提示词（优化版）

    生成格式：
    **角色名**

    - 行动计划: xxx
    - 战斗数据: 生命值 X/Y | 攻击力 Z
    - Effect: Effect1(描述), Effect2(描述) 或 无
    - 外观: xxx
    """

    if actor_agent.plan == "":
        return ""

    try:
        # 使用统一的资源读取函数
        actor_info = await read_actor_resource(mcp_client, actor_agent.name)

        # 提取基本信息
        name = actor_info.get("name", "未知")
        appearance = actor_info.get("appearance", "无描述")
        attributes = actor_info.get("attributes", {})
        effects = actor_info.get("effects", [])

        # 格式化属性
        health = attributes.get("health", 0)
        max_health = attributes.get("max_health", 0)
        attack = attributes.get("attack", 0)

        # 格式化 Effect（紧凑型，包含名称和描述）
        if effects:
            # 每个effect是一个dict，包含name和description
            effect_parts = []
            for effect in effects:
                effect_name = effect.get("name", "未知Effect")
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
- Effect: {effects_str}
- 外观: {appearance}"""

    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")

    return ""


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _collect_actor_plan_prompts(
    actor_agents: List[ActorAgent], mcp_client: McpClient
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
async def _handle_actor_plans_and_update_stage(
    stage_agent: StageAgent,
    mcp_client: McpClient,
) -> None:
    """处理场景执行指令

    收集所有角色的行动计划,由场景代理生成统一的行动执行描述。

    Args:
        stage_agent: 场景代理
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端
    """

    # logger.info(f"🎬 场景内执行: {stage_agent.name}")
    assert len(stage_agent.actor_agents) > 0, "没有可用的角色代理!!!!!!"
    # if len(stage_agent.actor_agents) == 0:
    #     logger.warning("⚠️  没有角色代理，跳过场景执行")
    #     return

    # 收集所有角色的行动计划
    actor_plans = await _collect_actor_plan_prompts(
        stage_agent.actor_agents, mcp_client
    )

    if not actor_plans:
        logger.warning("⚠️  没有角色有行动计划，跳过场景执行")
        return

    # 使用统一的资源读取函数
    stage_info_json: Dict[str, Any] = await read_stage_resource(
        mcp_client, stage_agent.name
    )

    # 构建行动执行提示词（MCP Workflow 版本 - 专注于分析和工具调用）
    step1_2_instruction = f"""# 指令！你（{stage_agent.name}）场景行动执行与使用工具同步状态

## 📊 输入数据

### 角色计划与信息

{"\n\n".join(actor_plans)}

### 当前角色状态

{stage_info_json.get("actor_states", "")}

### 当前环境

{stage_info_json.get("environment", "")}

### 当前场景连通性

{stage_info_json.get("connections", "")}

---

## 🎯 任务流程

接收角色计划 → 内部分析 → 调用工具同步状态

---

## 📝 执行步骤

### 步骤1: 内部分析

按顺序完成以下5项分析（后续步骤依赖前置结果）：

1. **计算结果与效果变化**
   - 战斗：综合考虑攻击力与效果影响计算伤害，新生命值 = 当前生命值 - 伤害（≤0则死亡）
   - 互动：分析过程和结果
   - 效果变化：分析本次行动是否触发场景机制
     - 添加：由场景/环境/其他角色施加的新效果
     - 移除：已消耗或失效的效果

2. **构建叙事**
   - 基于计算结果，第三人称描述行动过程
   - 数据与叙事保持一致

3. **角色状态**
   - 格式：`**角色名**: 位置 | 姿态 | 状态`
   - 基于叙事内容更新位置、姿态、特殊状态(如"隐藏")

4. **环境更新**
   - 基于叙事内容更新环境变化
   - 保留未变化部分

5. **场景连通性**
   - 分析本次行动是否改变了场景间的通行条件
   - 如有变化：更新描述（如"需要【钥匙】" → "已解锁，可自由通行"）
   - 如无变化：保持原值不变

---

### 步骤2: 调用工具

按顺序执行工具调用，保存步骤1的分析结果：

1. **同步场景状态** - 保存计算日志、叙事、角色状态、环境描述、场景连通性
2. **更新角色生命值** - 如有生命值变化，为每个角色调用一次
3. **添加 Effect** - 如有场景施加的新效果，为每个角色的每个新效果调用一次
4. **移除 Effect** - 如有已消耗的效果，为每个角色的每个消耗效果调用一次

💡 查看可用工具列表和了解使用方法。"""

    # 构建二次推理指令（独立的输出约束 - 不依赖主提示词结构）
    step3_instruction = HumanMessage(
        content="""# 指令！请输出工具调用总结

## ✅ 响应要求

输出以下JSON格式的总结：

```json
{
  "summary": "场景执行的简短总结（一句话）"
}
```"""
    )

    # 执行 MCP 工作流（改用支持工具调用的工作流，传入步骤3指令）
    stage_execution_response = await handle_mcp_workflow_execution(
        agent_name=stage_agent.name,
        context=stage_agent.context.copy(),
        request=HumanMessage(content=step1_2_instruction),
        llm=create_deepseek_llm(),
        mcp_client=mcp_client,  # 传入 MCP 客户端
        re_invoke_instruction=step3_instruction,  # 传入步骤3的二次推理指令
    )

    assert len(stage_execution_response) > 0, "场景执行响应为空"
    if len(stage_execution_response) < 2:
        logger.error("必须是2条消息，1次工具调用，2次总结输出，否则就不要进行了！")
        return

    try:

        # 必须2次总结输出的格式是合理的 StageExecutionSummary
        stage_execution_summary = StageExecutionSummary.model_validate_json(
            strip_json_code_block(str(stage_execution_response[-1].content))
        )

        logger.debug(
            f"✅ 场景执行结果解析成功: {stage_execution_summary.model_dump_json(indent=2)}"
        )

        # TODO 步骤1: 从 MCP 资源重新读取 stage 数据以获取最新的 narrative
        stage_info_updated = await read_stage_resource(mcp_client, stage_agent.name)
        narrative = stage_info_updated.get("narrative", "")

        # 步骤2: 更新场景代理的对话历史（压缩提示词）
        stage_agent.context.append(
            HumanMessage(
                content=_gen_compressed_stage_execute_prompt(
                    stage_agent.name, step1_2_instruction
                )
            )
        )

        # 步骤3: 记录场景执行结果到场景代理的对话历史
        stage_agent.context.append(
            AIMessage(
                content=f"""# 我（{stage_agent.name}） 场景内发生事件（执行结果）如下 \n\n {narrative}"""
            )
        )
        logger.debug(f"✅ 场景 {stage_agent.name} 执行结果 = \n{narrative}")
        stage_agent.context.append(
            HumanMessage(
                content=f"**注意**！你（{stage_agent.name}），场景信息已更新，请在下轮执行中考虑这些变化。"
            )
        )

        # 步骤4: 通知所有角色代理场景执行结果
        for actor_agent in stage_agent.actor_agents:

            scene_event_notification = f"""# 通知！{stage_agent.name} 场景发生事件：

## 叙事

{narrative}
    
以上事件已发生并改变了场景状态，这将直接影响你的下一步观察与规划。"""

            # 更新角色代理的对话历史
            actor_agent.context.append(HumanMessage(content=scene_event_notification))
            logger.debug(
                f"✅ 角色 {actor_agent.name} 收到场景执行结果通知 = \n{scene_event_notification}"
            )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_stage_execute(
    stage_agent: StageAgent,
    mcp_client: McpClient,
) -> None:

    if len(stage_agent.actor_agents) == 0:
        logger.warning(f"{stage_agent.name} 没有角色代理，是否跳过场景执行？")
        return

    logger.debug(
        f"🎬 场景执行: {stage_agent.name}, 场景内角色进行行动计划并更新场景状态"
    )
    await _handle_actor_plans_and_update_stage(
        stage_agent=stage_agent,
        mcp_client=mcp_client,
    )


########################################################################################################################
########################################################################################################################
########################################################################################################################

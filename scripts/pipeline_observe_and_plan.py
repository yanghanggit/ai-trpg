#!/usr/bin/env python3
"""
游戏流水线 - 观察与规划模块

负责处理角色的场景观察和行动规划流程。
"""

import asyncio
import json
from typing import Any, Dict, List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from ai_trpg.utils.json_format import strip_json_code_block
from agent_utils import GameAgent
from workflow_handlers import handle_chat_workflow_execution


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
def _filter_stage_info_for_actor(
    stage_info_json: Dict[str, Any], actor_name: str
) -> Dict[str, Any]:
    """过滤场景信息，移除对当前角色冗余的数据

    Args:
        stage_info_json: 完整的场景信息JSON
        actor_name: 当前角色名称

    Returns:
        过滤后的场景信息字典
    """
    filtered_stage_info: Dict[str, Any] = {}

    # 复制需要的字段
    for key in ["name", "environment", "actor_states"]:
        if key in stage_info_json:
            filtered_stage_info[key] = stage_info_json[key]

    # 过滤掉当前角色的外观信息（冗余）
    if "actors_appearance" in stage_info_json:
        actors_appearance = stage_info_json["actors_appearance"]
        if isinstance(actors_appearance, list):
            filtered_stage_info["actors_appearance"] = [
                actor for actor in actors_appearance if actor.get("name") != actor_name
            ]
        else:
            filtered_stage_info["actors_appearance"] = actors_appearance

    return filtered_stage_info


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _format_actor_info(actor_info_json: Dict[str, Any]) -> Dict[str, Any]:
    """格式化角色信息用于显示

    Args:
        actor_info_json: 角色信息JSON

    Returns:
        包含格式化字段的字典：name, appearance, health, max_health, attack, effects_str
    """
    actor_name = actor_info_json.get("name", "未知")
    actor_appearance = actor_info_json.get("appearance", "无描述")
    actor_attributes = actor_info_json.get("attributes", {})
    actor_effects = actor_info_json.get("effects", [])

    # 格式化战斗数据
    health = actor_attributes.get("health", 0)
    max_health = actor_attributes.get("max_health", 0)
    attack = actor_attributes.get("attack", 0)

    # 格式化状态效果
    if actor_effects:
        effect_parts = []
        for effect in actor_effects:
            effect_name = effect.get("name", "未知效果")
            effect_desc = effect.get("description", "")
            if effect_desc:
                effect_parts.append(f"{effect_name}({effect_desc})")
            else:
                effect_parts.append(effect_name)
        effects_str = ", ".join(effect_parts)
    else:
        effects_str = "无"

    return {
        "name": actor_name,
        "appearance": actor_appearance,
        "health": health,
        "max_health": max_health,
        "attack": attack,
        "effects_str": effects_str,
    }


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _format_other_actors_appearance(
    stage_actors_appearance: List[Dict[str, Any]],
) -> str:
    """格式化其他角色的外观信息

    Args:
        stage_actors_appearance: 场景中其他角色的外观数据列表
            （来自 MCP Server 的 _get_stage_info_impl，保证是列表类型）

    Returns:
        格式化后的 Markdown 字符串
    """
    if not stage_actors_appearance:
        return "无其他角色"

    other_actors_parts = []
    for actor in stage_actors_appearance:
        actor_name = actor.get("name", "未知")
        actor_appearance = actor.get("appearance", "无描述")
        other_actors_parts.append(
            f"""**{actor_name}**
- 外观: {actor_appearance}"""
        )
    return "\n\n".join(other_actors_parts)


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
        stage_agent: 场景代理
        actor_agent: 角色代理
        mcp_client: MCP 客户端（用于读取角色信息资源）
    """
    logger.warning(f"角色观察并规划: {actor_agent.name}")

    stage_resource_uri = f"game://stage/{stage_agent.name}"
    stage_resource_response = await mcp_client.read_resource(stage_resource_uri)
    if stage_resource_response is None or stage_resource_response.text is None:
        logger.error(f"❌ 未能读取资源: {stage_resource_uri}")
        return

    # 读取角色信息资源
    actor_resource_uri = f"game://actor/{actor_agent.name}"
    actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
    if actor_resource_response is None or actor_resource_response.text is None:
        logger.error(f"❌ 未能读取资源: {actor_resource_uri}")
        return

    stage_info_json = json.loads(stage_resource_response.text)
    actor_info_json = json.loads(actor_resource_response.text)

    # 过滤场景信息（移除冗余字段）
    filtered_stage_info = _filter_stage_info_for_actor(
        stage_info_json, actor_agent.name
    )

    # 格式化角色信息
    actor_info = _format_actor_info(actor_info_json)

    # 格式化场景信息
    stage_name = filtered_stage_info.get("name", "未知场景")
    stage_environment = filtered_stage_info.get("environment", "无描述")
    stage_actor_states = filtered_stage_info.get("actor_states", "无角色状态")
    stage_actors_appearance = filtered_stage_info.get("actors_appearance", [])

    # 格式化其他角色的外观
    other_actors_str = _format_other_actors_appearance(stage_actors_appearance)

    observe_and_plan_prompt = f"""# {actor_agent.name} 角色观察与行动规划

## 第一步: 你的角色信息 与 当前场景信息

### 你的角色信息

**{actor_info['name']}**
- 战斗数据: 生命值 {actor_info['health']}/{actor_info['max_health']} | 攻击力 {actor_info['attack']}
- 状态效果: {actor_info['effects_str']}
- 外观: {actor_info['appearance']}

### 当前场景信息

**场景**: {stage_name}

**环境描述**:
{stage_environment}

**场景中的角色位置与状态**:
{stage_actor_states}

**场景中的其他角色**:

{other_actors_str}

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

    try:

        assert len(actors_observe_and_plan_response) > 0, "角色观察与规划响应为空"

        # 步骤1: 从JSON代码块中提取字符串
        json_str = strip_json_code_block(
            str(actors_observe_and_plan_response[-1].content)
        )

        # 步骤2: 使用Pydantic解析和验证
        formatted_data = ActorObservationAndPlan.model_validate_json(json_str)

        # 更新角色代理的对话历史
        actor_agent.context.append(HumanMessage(content=observe_and_plan_prompt))
        assert len(actors_observe_and_plan_response) > 0, "角色观察与规划响应为空"

        # 步骤3: 将结果添加到角色的对话历史
        actor_agent.context.append(
            AIMessage(content=str(actors_observe_and_plan_response[-1].content))
        )

        # 记录角色的计划到属性中，方便后续使用
        actor_agent.plans = [formatted_data.plan]

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_all_actors_observe_and_plan(
    stage_agent: GameAgent,
    actor_agents: List[GameAgent],
    mcp_client: McpClient,
    use_concurrency: bool = False,
) -> None:
    """处理所有角色的观察和行动规划（合并版本，JSON输出）

    让每个角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。

    Args:
        stage_agent: 场景代理
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端（用于读取角色信息资源）
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    if use_concurrency:
        # 并行处理所有角色
        logger.debug(f"🔄 并行处理 {len(actor_agents)} 个角色的观察和规划")
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
        logger.debug(f"🔄 顺序处理 {len(actor_agents)} 个角色的观察和规划")
        for actor_agent in actor_agents:
            await _handle_single_actor_observe_and_plan(
                stage_agent=stage_agent,
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )

#!/usr/bin/env python3
"""
游戏流水线 - 角色更新模块

负责处理角色的自我状态更新流程。
"""

import asyncio
from typing import Any, Dict, List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from agent_utils import ActorAgent, StageAgent
from workflow_handlers import handle_mcp_workflow_execution
from ai_trpg.utils.json_format import strip_json_code_block
from mcp_client_resource_helpers import read_actor_resource


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorSelfUpdateConfirmation(BaseModel):
    """角色自我状态更新确认的数据模型

    用于验证和解析角色自我更新后的 JSON 输出。
    """

    appearance: str  # "是" 或 "否"
    effects: List[str]  # 新添加的 Effect 名称列表，如无则为空数组


def _gen_self_update_request_prompt(actor_name: str, actor_info: Dict[str, Any]) -> str:
    """
    生成角色自我状态更新请求提示词（步骤1-2：分析与工具调用）

    让LLM根据场景执行结果自主判断是否需要更新外观和添加 Effect。
    """

    # 提取角色属性信息
    attributes = actor_info.get("attributes", {})
    health = attributes.get("health", 0)
    max_health = attributes.get("max_health", 0)
    attack = attributes.get("attack", 0)

    # 提取角色效果信息
    effects = actor_info.get("effects", [])
    effects_text = ""
    if effects:
        effects_list = []
        for effect in effects:
            effect_name = effect.get("name", "")
            effect_desc = effect.get("description", "")
            effects_list.append(f"- **{effect_name}**: {effect_desc}")
        effects_text = "\n".join(effects_list)
    else:
        effects_text = "无"

    return f"""# 指令！你({actor_name}) 外观和Effect更新

## 📋 当前状态

**属性**: 生命值 {health}/{max_health} | 攻击力 {attack}

**Effect**: {effects_text}

---

## 🎯 任务

基于场景事件，判断是否需要：
1. **更新外观描述**（受伤、环境影响、装备变化等）
2. **添加新的 Effect**（伤势、增益、减益、心理状态等）

💡 **参考依据**：当前生命值 {health}/{max_health}、场景描述、角色行为

---

## 🔄 执行方式

根据判断结果，执行以下**三种情况之一**：

### 情况A - 更新外观

使用可用工具更新角色的外观描述（生成完整描述，80-120字）

### 情况B - 添加 Effect

使用可用工具为角色添加 Effect（名称2-6字，描述20-40字，每个独立添加）

### 情况C - 无需更新

**仅输出以下文本（不要添加任何解释或额外内容）**：

无需更新外观与Effect"""


########################################################################################################################
########################################################################################################################
########################################################################################################################


def _gen_self_update_confirmation_instruction() -> str:
    """
    生成角色自我状态更新的确认指令（步骤3：二次推理输出）

    这是独立的二次推理指令，用于在工具调用完成后输出确认结果。
    """
    return """# 指令！输出确认结果

工具已执行完成，请输出以下 JSON 格式：

```json
{
    "appearance": "是/否",
    "effects": ["Effect名称1", "Effect名称2"] 或 []
}
```

- `appearance`: 是否更新了外观
- `effects`: 新添加的 Effect 名称列表"""


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _gen_self_update_request_prompt_test(
    actor_name: str, actor_info: Dict[str, Any]
) -> str:
    """
    生成角色自我状态更新请求提示词（测试版本 - 强制更新）

    **测试用途**: 强制要求 LLM 必须更新外观和添加至少一个 Effect。
    """

    # 提取角色属性信息
    attributes = actor_info.get("attributes", {})
    health = attributes.get("health", 0)
    max_health = attributes.get("max_health", 0)
    attack = attributes.get("attack", 0)

    # 提取角色效果信息
    effects = actor_info.get("effects", [])
    effects_text = ""
    if effects:
        effects_list = []
        for effect in effects:
            effect_name = effect.get("name", "")
            effect_desc = effect.get("description", "")
            effects_list.append(f"- **{effect_name}**: {effect_desc}")
        effects_text = "\n".join(effects_list)
    else:
        effects_text = "无"

    return f"""# 指令！你({actor_name}) 外观和Effect更新（测试模式）

## 📋 当前状态

**属性**: 生命值 {health}/{max_health} | 攻击力 {attack}

**Effect**: {effects_text}

---

## 🎯 任务（必须执行）

基于场景事件，**必须完成以下两项更新**：
1. **更新外观描述**（受伤、环境影响、装备变化等） - **必须调用一次**
2. **添加新的 Effect**（伤势、增益、减益、心理状态等） - **至少添加一个**

💡 **参考依据**：当前生命值 {health}/{max_health}、场景描述、角色行为

---

## 🔄 执行方式（按顺序执行）

### 步骤1 - 更新外观（必须）

使用可用工具更新角色的外观描述（生成完整描述，80-120字）

### 步骤2 - 添加 Effect（必须）

使用可用工具为角色添加至少一个 Effect（名称2-6字，描述20-40字，每个独立添加）

---

⚠️ **测试模式说明**：本提示词用于测试，必须执行所有更新操作，不可跳过。"""


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_single_actor_self_update(
    actor_agent: ActorAgent,
    mcp_client: McpClient,
) -> None:
    """处理单个角色的自我状态更新

    角色根据场景执行结果（在上下文中）判断是否需要：
    1. 更新外观描述（如受伤、变化等）
    2. 添加新的 Effect（如增益、减益等）

    通过调用 MCP 工具实现状态更新。

    Args:
        actor_agent: 角色代理
        mcp_client: MCP 客户端
    """

    # 使用统一的资源读取函数
    actor_info: Dict[str, Any] = await read_actor_resource(mcp_client, actor_agent.name)
    # logger.debug(f"🔄 角色 {actor_agent.name} 当前数据: {actor_info}")

    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "获取 MCP 可用工具失败"

    # 步骤1-2: 分析与工具调用
    step1_2_instruction = _gen_self_update_request_prompt(actor_agent.name, actor_info)
    # step1_2_instruction = _gen_self_update_request_prompt_test(
    #     actor_agent.name, actor_info
    # )

    # 步骤3: 二次推理输出确认（独立指令）
    step3_instruction = HumanMessage(
        content=_gen_self_update_confirmation_instruction()
    )

    # mcp 的工作流（传入二次推理指令）
    self_update_response = await handle_mcp_workflow_execution(
        agent_name=actor_agent.name,
        context=actor_agent.context.copy(),
        request=HumanMessage(content=step1_2_instruction),
        llm=create_deepseek_llm(),
        mcp_client=mcp_client,
        re_invoke_instruction=step3_instruction,  # 传入步骤3的二次推理指令
    )

    # 🎯 根据响应长度判断执行路径
    response_count = len(self_update_response)

    if response_count == 0:
        logger.error(f"❌ 角色 {actor_agent.name} 自我更新未收到回复")
        return

    elif response_count == 1:
        # 情况1: 只有第一次推理，可能是以下情况：
        # A. LLM 判断无需更新，输出指定文本（正常）
        # B. LLM 尝试调用工具但工具流程失败（异常，但安全截断）
        # C. LLM 输出非预期内容（异常）
        first_response_content = str(self_update_response[0].content).strip()

        # 移除可能的 Markdown 格式（如 **文本**）并清理空白
        cleaned_content = (
            first_response_content.replace("**", "")
            .replace("*", "")
            .strip()
            .split("\n")[0]
            .strip()
        )

        # 精确匹配指定文本（支持带/不带 Markdown 格式）
        if cleaned_content == "无需更新外观与Effect":
            logger.info(f"✅ 角色 {actor_agent.name} 无需更新（明确声明）")
        elif "tool_call" in first_response_content.lower():
            logger.warning(
                f"⚠️ 角色 {actor_agent.name} 工具调用流程中断 (安全截断)\n"
                f"   可能原因: 工具解析失败/执行失败/网络错误\n"
                f"   LLM 输出: {first_response_content[:150]}..."
            )
        else:
            logger.warning(
                f"⚠️ 角色 {actor_agent.name} 输出非预期内容\n"
                f"   期望: '无需更新外观与Effect' 或工具调用\n"
                f"   实际: {first_response_content[:150]}..."
            )
        return

    elif response_count == 2:
        # 情况2: 完整流程 (第一次推理 + 工具调用 + 二次推理)
        try:
            # 验证二次推理的 JSON 格式
            confirmation = ActorSelfUpdateConfirmation.model_validate_json(
                strip_json_code_block(str(self_update_response[-1].content))
            )

            logger.success(
                f"✅ 角色 {actor_agent.name} 状态更新完成\n"
                f"   外观更新: {confirmation.appearance}\n"
                f"   新增 Effect: {confirmation.effects}"
            )

            # 在这里注意，不要添加任何新的对话历史，所有的更新都在 MCP 工作流中完成！
            logger.debug(
                f"💡 角色 {actor_agent.name} 的所有更新已通过 MCP 工具持久化，对话历史未变更"
            )

        except Exception as e:
            logger.error(
                f"❌ 角色 {actor_agent.name} 二次推理 JSON 解析失败: {e}\n"
                f"   响应内容: {self_update_response[-1].content}"
            )

    else:
        # 情况3: 异常情况（不应该出现）
        logger.error(
            f"❌ 角色 {actor_agent.name} 响应数量异常: {response_count}\n"
            f"   期望: 1 (无需更新) 或 2 (完整流程)，实际: {response_count}"
        )


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _update_actor_death_status(
    actor_agent: ActorAgent,
    all_actor_agents: List[ActorAgent],
    mcp_client: McpClient,
) -> None:
    """检查单个角色是否死亡

    通过读取角色资源中的生命值属性判断角色是否死亡。

    Args:
        actor_agent: 角色代理
        mcp_client: MCP 客户端
    """

    # 使用统一的资源读取函数
    actor_info: Dict[str, Any] = await read_actor_resource(mcp_client, actor_agent.name)
    attributes = actor_info.get("attributes", {})
    health = attributes.get("health", 0)

    if health <= 0:

        # 角色死亡处理
        actor_agent.is_dead = True
        logger.warning(f"💀 角色 {actor_agent.name} 已死亡！")

        # 通知自己
        actor_agent.context.append(
            HumanMessage(content=f"# 通知！你（{actor_agent.name}）已经死亡！")
        )

        # 通知其他角色
        for other_agent in all_actor_agents:
            if other_agent.name != actor_agent.name:
                other_agent.context.append(
                    HumanMessage(content=f"# 通知！角色 {actor_agent.name} 已经死亡！")
                )

    else:
        actor_agent.is_dead = False
        logger.debug(f"✅ 角色 {actor_agent.name} 仍然存活，当前生命值: {health}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_actors_self_update(
    # actor_agents: List[ActorAgent],
    stage_agent: StageAgent,
    mcp_client: McpClient,
    use_concurrency: bool = False,
) -> None:
    """处理所有角色的自我状态更新

    Args:
        actor_agents: 角色代理列表
        mcp_client: MCP 客户端
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    if use_concurrency:

        logger.debug(f"🔄 并行处理 {len(stage_agent.actor_agents)} 个角色的自我更新")
        tasks1 = [
            _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            for actor_agent in stage_agent.actor_agents
        ]
        await asyncio.gather(*tasks1)

        tasks2 = [
            _update_actor_death_status(
                actor_agent=actor_agent,
                all_actor_agents=stage_agent.actor_agents,
                mcp_client=mcp_client,
            )
            for actor_agent in stage_agent.actor_agents
        ]
        await asyncio.gather(*tasks2)

    else:

        logger.debug(f"🔄 顺序处理 {len(stage_agent.actor_agents)} 个角色的自我更新")
        for actor_agent in stage_agent.actor_agents:
            await _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            await _update_actor_death_status(
                actor_agent=actor_agent,
                all_actor_agents=stage_agent.actor_agents,
                mcp_client=mcp_client,
            )


########################################################################################################################
########################################################################################################################
########################################################################################################################

#!/usr/bin/env python3
"""
游戏流水线 - 角色更新模块

负责处理角色的自我状态更新流程。
"""

import asyncio
import json
from typing import Any, Dict, List
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from agent_utils import GameAgent
from workflow_handlers import handle_mcp_workflow_execution
from ai_trpg.utils.json_format import strip_json_code_block


########################################################################################################################
########################################################################################################################
########################################################################################################################
class ActorSelfUpdateConfirmation(BaseModel):
    """角色自我状态更新确认的数据模型

    用于验证和解析角色自我更新后的 JSON 输出。
    """

    appearance: str  # "是" 或 "否"
    effects: List[str]  # 新添加的 效果/状态 名称列表，如无则为空数组


def _gen_self_update_request_prompt(actor_name: str, actor_info: Dict[str, Any]) -> str:
    """
    生成角色自我状态更新请求提示词（步骤1-2：分析与工具调用）

    让LLM根据场景执行结果自主判断是否需要更新外观和添加 效果/状态。
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
        effects_text = "- 当前无 效果/状态"

    return f"""# {actor_name} 状态更新

## 📋 当前状态

**属性**: 生命值 {health}/{max_health} | 攻击力 {attack}

**效果/状态**: {effects_text if effects else "无"}

---

## 🎯 任务

基于场景事件，判断是否需要：
1. **更新外观**（受伤、环境影响、装备变化等）
2. **添加 效果/状态 **（伤势、增益/减益、心理状态等）

💡 无明显变化可不更新

---

## 🔄 执行流程

**整体**: 分析场景变化 → 调用工具保存数据

### 步骤 1️⃣: 判断是否需要更新

参考当前生命值 {health}/{max_health}，判断外观和 效果/状态 是否需要更新

⚠️ 不要输出分析过程

### 步骤 2️⃣: 调用工具（如需更新）

**🚨 重要**: 如果步骤1判断需要更新，**必须调用工具**，不能只在JSON中声明

#### 情况A：需要更新外观
- **必须**调用工具更新外观
- 生成完整外观描述（80-120字）

#### 情况B：需要添加 效果/状态  
- **必须**为每个 效果/状态调用工具添加
- 效果/状态 名称2-6字，描述20-40字
- 一个 效果/状态 = 一次工具调用

#### 情况C：无需更新
- 不调用任何工具"""


########################################################################################################################
########################################################################################################################
########################################################################################################################


def _gen_self_update_confirmation_instruction() -> str:
    """
    生成角色自我状态更新的确认指令（步骤3：二次推理输出）

    这是独立的二次推理指令，用于在工具调用完成后输出确认结果。
    """
    return """# 请输出状态更新确认

**工具调用完成 → 输出JSON确认**

## ⚠️ 约束条件

- **禁止再次调用工具** - 所有工具已执行完成
- **禁止输出工具调用格式** - 不要生成 {"tool_call": ...} 这样的JSON结构

## ✅ 响应要求

输出以下JSON格式的确认结果：

```json
{
    "appearance": "是/否",
    "effects": ["效果/状态1", "效果/状态2"] 或 []
}
```

**说明**：
- `appearance`: 填写 "是" 或 "否"，表示是否更新了外观
- `effects`: 列出所有新添加的 效果/状态 名称，如无则为空数组 []

⚠️ **注意**: JSON中的内容必须如实反映**实际调用的工具**，不能声明未执行的操作"""


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_single_actor_self_update(
    actor_agent: GameAgent,
    mcp_client: McpClient,
) -> None:
    """处理单个角色的自我状态更新

    角色根据场景执行结果（在上下文中）判断是否需要：
    1. 更新外观描述（如受伤、变化等）
    2. 添加新的状态效果（如增益、减益等）

    通过调用 MCP 工具实现状态更新。

    Args:
        actor_agent: 角色代理
        mcp_client: MCP 客户端
    """

    actor_resource_uri = f"game://actor/{actor_agent.name}"
    actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
    if actor_resource_response is None or actor_resource_response.text is None:
        assert False, f"获取角色资源失败: {actor_resource_uri}"

    # 解析角色数据
    actor_info: Dict[str, Any] = json.loads(actor_resource_response.text)
    # logger.debug(f"🔄 角色 {actor_agent.name} 当前数据: {actor_info}")

    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "获取 MCP 可用工具失败"

    # 步骤1-2: 分析与工具调用
    step1_2_instruction = _gen_self_update_request_prompt(actor_agent.name, actor_info)

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

    if len(self_update_response) == 0:
        logger.error(f"❌ 角色 {actor_agent.name} 自我更新未收到回复")
        return

    # 验证响应格式
    try:

        # 验证 JSON 格式
        confirmation = ActorSelfUpdateConfirmation.model_validate_json(
            strip_json_code_block(str(self_update_response[-1].content))
        )

        logger.debug(
            f"✅ 角色 {actor_agent.name}:\n {confirmation.model_dump_json(indent=2)}"
        )

        # 在这里注意，不要添加任何新的对话历史，所有的更新都在 MCP 工作流中完成！
        logger.warning(
            f"✅ 角色 {actor_agent.name} 自我状态更新完成, 注意对话历史未变更，所有更新在 MCP 工作流中完成"
        )

    except Exception as e:
        logger.error(f"❌ 角色 {actor_agent.name} 更新确认解析失败: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _update_actor_death_status(
    actor_agent: GameAgent,
    mcp_client: McpClient,
) -> None:
    """检查单个角色是否死亡

    通过读取角色资源中的生命值属性判断角色是否死亡。

    Args:
        actor_agent: 角色代理
        mcp_client: MCP 客户端
    """

    actor_resource_uri = f"game://actor/{actor_agent.name}"
    actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
    if actor_resource_response is None or actor_resource_response.text is None:
        assert False, f"获取角色资源失败: {actor_resource_uri}"

    # 解析角色数据
    actor_info: Dict[str, Any] = json.loads(actor_resource_response.text)
    attributes = actor_info.get("attributes", {})
    health = attributes.get("health", 0)

    if health <= 0:
        actor_agent.is_dead = True
        logger.warning(f"💀 角色 {actor_agent.name} 已死亡！")
        actor_agent.context.append(
            HumanMessage(content=f"# 你（{actor_agent.name}）已经死亡！")
        )

    else:
        actor_agent.is_dead = False
        logger.debug(f"✅ 角色 {actor_agent.name} 仍然存活，当前生命值: {health}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_all_actors_self_update(
    actor_agents: List[GameAgent],
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

        logger.debug(f"🔄 并行处理 {len(actor_agents)} 个角色的自我更新")
        tasks1 = [
            _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            for actor_agent in actor_agents
        ]
        await asyncio.gather(*tasks1)

        tasks2 = [
            _update_actor_death_status(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            for actor_agent in actor_agents
        ]
        await asyncio.gather(*tasks2)

    else:

        logger.debug(f"🔄 顺序处理 {len(actor_agents)} 个角色的自我更新")
        for actor_agent in actor_agents:
            await _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            await _update_actor_death_status(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )


########################################################################################################################
########################################################################################################################
########################################################################################################################

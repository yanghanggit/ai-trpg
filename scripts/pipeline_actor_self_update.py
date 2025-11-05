#!/usr/bin/env python3
"""
游戏流水线 - 角色更新模块

负责处理角色的自我状态更新流程。
"""

import asyncio
import json
from typing import Any, Dict, List
from loguru import logger
from langchain.schema import HumanMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from agent_utils import GameAgent
from workflow_handlers import handle_mcp_workflow_execution


def _gen_self_update_request_prompt(actor_name: str, actor_info: Dict[str, Any]) -> str:
    """
    生成角色自我状态更新请求提示词（正式版）

    让LLM根据场景执行结果自主判断是否需要更新外观和添加效果。
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
        effects_text = "- 当前无效果"

    return f"""# {actor_name} 状态更新

## 📋 当前状态

**属性**: 生命值 {health}/{max_health} | 攻击力 {attack}

**效果**: {effects_text if effects else "无"}

---

## 🎯 任务

基于场景事件，判断是否需要：
1. **更新外观**（受伤、环境影响、装备变化等）
2. **添加效果**（伤势、增益/减益、心理状态等）

💡 无明显变化可不更新

---

## 🔄 执行流程

**整体**: 分析场景变化 → 调用工具保存数据 → 输出确认

### 步骤 1️⃣: 判断是否需要更新

参考当前生命值 {health}/{max_health}，判断外观和效果是否需要更新

⚠️ 不要输出分析过程

### 步骤 2️⃣: 调用工具（如需更新）

**🚨 重要**: 如果步骤1判断需要更新，**必须调用工具**，不能只在JSON中声明

#### 情况A：需要更新外观
- **必须**调用工具更新外观
- 生成完整外观描述（80-120字）

#### 情况B：需要添加效果  
- **必须**为每个效果调用工具添加
- 效果名称2-6字，描述20-40字
- 一个效果 = 一次工具调用

#### 情况C：无需更新
- 不调用任何工具

💡 查看工具列表，docstring告诉你如何使用

### 步骤 3️⃣: 输出确认

**工具调用完成 → 输出JSON确认**

```json
{{
    "appearance": "是/否",
    "effects": ["效果1", "效果2"] 或 []
}}
```

⚠️ **注意**: JSON中的 "是/否" 和 effects列表必须如实反映**实际调用的工具**，不能声明未执行的操作

---

## ✅ 输出要求

- JSON格式如实反映实际操作
- 不解释过程"""


def _gen_self_update_request_prompt_test_v1(
    actor_name: str, actor_info: Dict[str, Any]
) -> str:
    """
    生成角色自我状态更新请求提示词（测试版v1）,
    因为测试模式下需要强制执行更新外观和添加效果。
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
        effects_text = "- 当前无效果"

    return f"""# {actor_name} 状态更新

## 📋 当前角色状态

**属性**
- 生命值: {health}/{max_health}
- 攻击力: {attack}

**当前效果**
{effects_text}

---

## ⚠️ 强制要求（测试模式）

**本次必须完成的任务**：
1. ✅ 更新角色外观描述（必须）
2. ✅ 添加至少1个新状态效果（必须）

💡 **提示**：即使场景中变化很小，也必须执行上述任务。这是测试模式的强制要求。

---

## 🔄 执行流程

**整体流程**：分析当前状态 → 调用工具更新数据 → 输出确认结果

### 步骤 1️⃣：准备阶段

**任务**：基于场景执行结果和当前状态，规划需要更新的内容
- **外观更新**：受伤痕迹、衣物变化、装备状态、环境影响等（参考生命值 {health}/{max_health}）
- **效果更新**：新增伤势、增益/减益、环境效果、心理状态等（避免与已有效果重复）

⚠️ **注意**：这是思考阶段，不要输出分析过程

### 步骤 2️⃣：工具调用阶段

**任务**：调用工具保存状态更新

**流程**：准备完成 → 调用工具 → 保存状态

- **更新外观**：生成新的完整外观描述（80-120字），体现当前生命值和效果的影响
- **添加效果**：添加1-2个新状态效果，每个效果包含名称（2-6字）和描述（20-40字）

💡 **提示**：查看可用工具列表，工具的 docstring 会告诉你如何使用它们

### 步骤 3️⃣：确认阶段

**任务**：输出更新确认（JSON格式）

**流程**：工具执行完成 → 收集结果 → 输出确认

```json
{{
    "appearance": "是",
    "effects": ["效果1", "效果2"]
}}
```

**说明**：
- `appearance`: 固定填写 "是"（测试模式强制更新）
- `effects`: 列出所有新添加的效果名称

---

## ✅ 输出要求

- ✅ 使用 JSON 格式输出确认结果
- ✅ 确保所有工具调用都已执行
- ❌ 不要解释工具调用过程"""


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

    # self_update_request_prompt = _gen_self_update_request_prompt_test_v1(
    #     actor_agent.name, actor_info
    # )

    self_update_request_prompt = _gen_self_update_request_prompt(
        actor_agent.name, actor_info
    )

    # mcp 的工作流
    await handle_mcp_workflow_execution(
        agent_name=actor_agent.name,
        context=actor_agent.context.copy(),
        request=HumanMessage(content=self_update_request_prompt),
        llm=create_deepseek_llm(),
        mcp_client=mcp_client,
    )

    # 在这里注意，不要添加任何新的对话历史，所有的更新都在 MCP 工作流中完成！
    logger.warning(
        f"✅ 角色 {actor_agent.name} 自我状态更新完成, 注意对话历史未变更，所有更新在 MCP 工作流中完成"
    )


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

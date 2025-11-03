#!/usr/bin/env python3
"""
游戏流水线 - 角色更新模块

负责处理角色的自我状态更新流程。
"""

import asyncio
from typing import List
from loguru import logger
from langchain.schema import HumanMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from agent_utils import GameAgent
from workflow_handlers import handle_mcp_workflow_execution


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

    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "获取 MCP 可用工具失败"

    self_update_request_prompt = f"""# {actor_agent.name} 状态更新分析

阅读对话历史中的**场景执行结果**，分析是否需要更新角色状态。

## 第一步：内部决策（不要输出，仅思考）

**外观判断**：
- 是否有身体损伤（流血、骨折、烧伤等）？
- 是否有衣物变化（破损、沾染、脱落等）？
- 是否有装备更换（武器、护甲变化）？
- 是否有环境影响（沾泥、淋雨、染血等）？
→ 如果有任一项，准备新的完整外观描述（80-120字）

**效果判断**：
- 是否获得伤势（轻伤、重伤、流血等）？
- 是否获得增益（力量提升、防护等）？
- 是否获得减益（虚弱、中毒、恐惧等）？
- 是否获得环境效果（潮湿、寒冷等）？
- 是否产生心理状态变化（愤怒、冷静、疯狂等）？
→ 如果有，列出所有新效果（每个：名称2-6字，描述20-40字）

## 第二步：执行输出

**情况A：需要更新**
一次性输出所有工具调用（JSON格式）：
- 如果外观改变 → 调用工具: 更新外观描述
- 如果有新效果 → 执行多个 ‘添加一个新的Effect（效果/状态）’ 工具调用（每个效果一个）

**情况B：无需更新**
直接回复："无需更新"（四个字，不要其他内容）

## 🔴 测试模式（强制要求）
当前处于测试阶段，**必须执行情况A**：
1. 生成 更新外观描述 工具调用（即使只是微调描述）
2. 生成至少1个 ‘添加一个新的Effect（效果/状态）’ 工具调用（如"警觉"、"紧张"等合理状态）

## ⚠️ 重要：最终输出格式（请严格遵守）

在工具调用完成后，必须输出以下JSON格式来总结更新结果：

```json
{{
    "update_actor_appearance": "如果调用了update_actor_appearance工具，这里填写更新的外观描述；否则填写 无需更新",
    "add_actor_effects": [
        "如果调用了add_actor_effect工具，这里列出所有添加的效果名称",
        "效果名称2",
        "..."
    ]
}}
```

**注意**：最终必须输出这个JSON代码块"""

    # mcp 的工作流
    mcp_response = await handle_mcp_workflow_execution(
        agent_name=actor_agent.name,
        context={
            "messages": actor_agent.context.copy(),
            "llm": create_deepseek_llm(),
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        },
        request={
            "messages": [HumanMessage(content=self_update_request_prompt)],
            "llm": create_deepseek_llm(),
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        },
    )

    # 更新当前代理的对话历史
    # actor_agent.context.append(HumanMessage(content=self_update_request_prompt))
    # actor_agent.context.extend(mcp_response)


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
        tasks = [
            _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )
            for actor_agent in actor_agents
        ]
        await asyncio.gather(*tasks)
    else:
        logger.debug(f"🔄 顺序处理 {len(actor_agents)} 个角色的自我更新")
        for actor_agent in actor_agents:
            await _handle_single_actor_self_update(
                actor_agent=actor_agent,
                mcp_client=mcp_client,
            )

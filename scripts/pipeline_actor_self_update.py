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


def _gen_self_update_request_prompt_test_v1(actor_name: str) -> str:
    """
    生成角色自我状态更新请求提示词（测试版v1）,
    因为测试模式下需要强制执行更新外观和添加效果。
    """

    return f"""# {actor_name} 更新

## ⚠️ 强制要求（测试模式）

**必须执行以下操作**：
1. 必须调用 `update_actor_appearance` 工具 更新外观!
2. 必须调用至少1个 `add_actor_effect` 工具 添加效果!

## 第一步：内部分析（仅思考，不输出）

基于场景执行结果，确定：
- **外观更新内容**：受伤痕迹、衣物变化、装备状态、环境影响等
- **新增效果内容**：伤势、增益/减益、环境效果、心理状态等

## 第二步：执行工具调用（必须）

**必须执行以下工具调用**：

1. 调用 `update_actor_appearance` 工具
   - 参数：新的完整的外观描述（80-120字）
   - 基于原有外观 + 场景中的变化

2. 调用 `add_actor_effect` 工具（至少1次）
   - 参数：效果名称（2-6字）、效果描述（20-40字）
   - 可以是战斗相关、心理状态、环境影响等
   - 如需添加多个效果，多次调用此工具

## 第三步：收集工具返回结果

记录所有工具调用的返回信息，用于第四步输出。

## 第四步：输出最终JSON结果（必须）

```json
{{
    "appearance": "是否更新了外观？仅回答：是/否",
    "effects": [
        "添加的效果名称1",
        "添加的效果名称2"
    ]
}}

### 注意!

- 请严格按照上述格式输出JSON结果，确保 JSON 格式正确无误。
- appearance 填写调用 update_actor_appearance 工具后返回的外观描述
- effects 填写所有调用 add_actor_effect 工具添加的效果名称列表"""


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

    self_update_request_prompt = _gen_self_update_request_prompt_test_v1(
        actor_agent.name
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

#!/usr/bin/env python3
"""
游戏流水线 - 场景更新模块

负责处理场景的自我状态更新流程。
"""

import asyncio
from typing import Any, Dict
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.utils.json_format import strip_json_code_block
from agent_utils import GameAgentManager, StageAgent
from workflow_handlers import handle_chat_workflow_execution
from mcp_client_resource_helpers import read_stage_resource
from ai_trpg.pgsql import (
    get_actor_movement_events_by_stage,
    clear_all_actor_movement_events,
    get_stage_context,
    add_stage_context,
    add_actor_context,
)


#
def _gen_compressed_stage_update_prompt(stage_name: str, original_message: str) -> str:
    """生成压缩版本的场景更新提示词

    Args:
        stage_name: 场景名称
        original_message: 原始提示词（未使用，保留用于调试）

    Returns:
        压缩后的提示词
    """
    compressed_message = f"""# 指令！你（{stage_name}）因角色进入事件需要更新场景状态"""
    return compressed_message


########################################################################################################################
########################################################################################################################
########################################################################################################################
class StageUpdateResult(BaseModel):
    """场景更新结果的数据模型

    用于解析和验证场景自我更新的JSON输出，包含叙事、角色状态、环境和连通性。
    """

    narrative: str  # 场景叙事描述
    actor_states: str  # 角色状态列表（字符串格式）
    environment: str  # 环境描述
    connections: str  # 场景连通性描述


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_stage_self_update(
    game_agent_manager: GameAgentManager,
    use_concurrency: bool = False,
) -> None:
    """处理场景自我更新

    Args:
        game_agent_manager: 游戏代理管理器
        mcp_client: MCP 客户端实例
        use_concurrency: 是否使用并发处理
    """
    logger.info("🎭 开始场景自我更新流程...")

    stage_agents = game_agent_manager.stage_agents
    if len(stage_agents) == 0:
        logger.warning("⚠️ 没有可用的场景代理，无法进行场景自我更新")
        return

    # TODO: 实现场景自我更新逻辑
    if use_concurrency:

        logger.debug(f"🔄 并行处理 {len(stage_agents)} 个场景的自我更新")
        stage_update_tasks = [
            _handle_stage_self_update(
                stage_agent=stage_agent,
                game_agent_manager=game_agent_manager,
            )
            for stage_agent in stage_agents
        ]
        await asyncio.gather(*stage_update_tasks, return_exceptions=True)

    else:

        logger.debug(f"🔄 顺序处理 {len(stage_agents)} 个场景的自我更新")
        for stage_agent in stage_agents:
            await _handle_stage_self_update(
                stage_agent=stage_agent,
                game_agent_manager=game_agent_manager,
            )

    logger.info("✅ 场景自我更新流程完成")

    # 清理当前世界的角色移动事件
    logger.debug(
        "🧹 清理当前世界的角色移动事件数据库..., 因为在场景自我更新完成后，角色移动事件已处理完毕"
    )
    # if game_agent_manager.world_name:
    #     world_id = get_world_id_by_name(game_agent_manager.world_name)
    #     if world_id:
    clear_all_actor_movement_events(game_agent_manager.world_id)
    # else:
    #     logger.warning(
    #         f"⚠️ 未找到世界 '{game_agent_manager.world_name}' 的数据库记录"
    #     )


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_stage_self_update(
    stage_agent: StageAgent,
    game_agent_manager: GameAgentManager,
) -> None:
    """处理单个场景的自我状态更新

    根据历史上下文和最新的角色进入事件，更新场景的叙事、角色状态、环境和连通性。

    Args:
        stage_agent: 场景代理
        game_agent_manager: 游戏代理管理器
    """
    logger.debug(f"🔄 正在更新场景代理: {stage_agent.name}")

    # 获取 world_id (用于数据库查询)
    # world_name = game_agent_manager.world_name
    # if world_name is None:
    #     logger.error("❌ GameAgentManager 未初始化 world_name,无法查询角色移动事件")
    #     return

    # world_id = get_world_id_by_name(game_agent_manager.world_name)
    # if world_id is None:
    #     logger.error(f"❌ 未找到世界 '{game_agent_manager.world_name}' 的数据库记录")
    #     return

    # 检查是否有角色进入当前场景的事件 (从数据库查询)
    movement_events = get_actor_movement_events_by_stage(
        stage_agent.world_id, stage_agent.name
    )

    if len(movement_events) == 0:
        logger.debug(f"ℹ️ 场景 {stage_agent.name} 无角色进入事件，跳过更新")
        return

    logger.debug(
        f"📋 场景 {stage_agent.name} 检测到 {len(movement_events)} 个角色进入事件"
    )

    # 执行角色转移（遍历所有进入事件）
    for event in movement_events:
        move_success = game_agent_manager.move_actor_to_stage(
            actor_name=event.actor_name, target_stage_name=event.to_stage
        )

        if not move_success:
            logger.warning(
                f"⚠️ 角色 [{event.actor_name}] 移动到场景 [{event.to_stage}] 失败"
            )

    try:
        # 步骤1: 读取场景资源
        stage_info: Dict[str, Any] = await read_stage_resource(
            stage_agent.mcp_client, stage_agent.name
        )

        # 步骤2: 构建角色进入事件信息
        # 构建进入事件列表的字符串
        events_info = []
        entering_actor_names = []
        for event in movement_events:
            events_info.append(
                f"""- **角色名称**: {event.actor_name}
- **来源场景**: {event.from_stage}
- **目标场景**: {event.to_stage}
- **进入姿态与状态**: {event.entry_posture_and_status}"""
            )
            entering_actor_names.append(f'"{event.actor_name}"')

        events_section = "\n\n".join(events_info)
        entering_actors_str = "、".join(entering_actor_names)

        # 步骤3: 构建场景更新提示词
        stage_update_prompt = f"""# 指令！你（{stage_agent.name}）因角色进入事件需要更新场景状态

## 🚪 触发事件：角色进入场景

{events_section}

---

## 📊 当前场景信息

### 当前叙事

{stage_info.get("narrative", "")}

### 当前场景内已有角色状态

{stage_info.get("actor_states", "无角色")}

### 当前环境

{stage_info.get("environment", "")}

### 当前场景连通性

{stage_info.get("connections", "")}

---

## 🎯 更新任务

**触发原因**：场景内角色发生变化（{len(movement_events)} 个新角色进入：{entering_actors_str}）

**更新流程**（按顺序完成，后续步骤依赖前置结果）：

1. **构建叙事（narrative）**
   - 第三人称描述新进入角色的过程和当前场景状态
   - 叙事应包含：进入方式、当前位置、周围环境反应
   - 如有多个角色进入，需合理编排叙事顺序

2. **更新角色状态（actor_states）**
   - 基于叙事内容，更新场景内所有角色的状态
   - 保留"当前场景内已有角色状态"中的所有老角色
   - 添加所有新进入的角色（从叙事和进入信息中提取位置、姿态、状态）
   - 格式统一为：`**角色名**: 位置 | 姿态 | 状态`

3. **更新环境（environment）**
   - 基于叙事内容，更新因角色进入导致的环境变化
   - 保留未变化部分

4. **更新连通性（connections）**
   - 基于叙事内容，检查是否因角色进入改变了通行条件
   - 有实质性改变则更新，否则保持原值

---

## 📝 输出格式

输出以下JSON格式：

```json
{{
    "narrative": "更新后的场景叙事描述",
    "actor_states": "更新后的角色状态列表（包含老角色 + 所有新进入的角色）",
    "environment": "更新后的环境描述",
    "connections": "更新后的场景连通性"
}}
```

**注意**：

- **actor_states** 必须包含所有角色（老角色 + 所有新进入的角色）
- 角色状态格式必须统一：`**角色名**: 位置 | 姿态 | 状态`
- 叙事描述应该第三人称，简洁明了
- 只更新因角色进入而实际发生变化的部分"""

        # 从数据库读取上下文
        stage_context = get_stage_context(stage_agent.world_id, stage_agent.name)

        # 步骤3: 调用 Chat Workflow 进行推理
        stage_update_response = await handle_chat_workflow_execution(
            agent_name=stage_agent.name,
            context=stage_context,
            request=HumanMessage(content=stage_update_prompt),
            llm=create_deepseek_llm(),
        )

        if not stage_update_response:
            logger.warning(f"⚠️ 场景 {stage_agent.name} 更新响应为空")
            return

        # 步骤4: 解析返回的 JSON 结果
        try:
            stage_update_result = StageUpdateResult.model_validate_json(
                strip_json_code_block(str(stage_update_response[-1].content))
            )

            logger.debug(
                f"✅ 场景 {stage_agent.name} 更新结果解析成功: {stage_update_result.model_dump_json(indent=2)}"
            )

            # 步骤5: 调用 MCP tool 同步数据到服务器
            tool_result = await stage_agent.mcp_client.call_tool(
                tool_name="update_stage_execution_result",
                arguments={
                    "stage_name": stage_agent.name,
                    "calculation_log": "",  # 场景自我更新不需要计算日志
                    "narrative": stage_update_result.narrative,
                    "actor_states": stage_update_result.actor_states,
                    "environment": stage_update_result.environment,
                    "connections": stage_update_result.connections,
                },
            )

            if not tool_result.success:
                logger.error(f"❌ 同步场景状态到服务器失败: {tool_result.error}")
                return

            logger.info(f"✅ 场景 {stage_agent.name} 状态已同步到服务器")

            # 批量添加场景消息到数据库
            add_stage_context(
                stage_agent.world_id,
                stage_agent.name,
                [
                    HumanMessage(
                        content=_gen_compressed_stage_update_prompt(
                            stage_agent.name, stage_update_prompt
                        )
                    ),
                    AIMessage(
                        content=f"""# 我（{stage_agent.name}）场景内发生事件（角色进入）如下 \n\n {stage_update_result.narrative}"""
                    ),
                    HumanMessage(
                        content=f"**注意**！你（{stage_agent.name}），场景信息已更新，请在下轮执行中考虑这些变化。"
                    ),
                ],
            )
            logger.debug(
                f"✅ 场景 {stage_agent.name} 更新结果 = \n{stage_update_result.narrative}"
            )

            # 批量通知所有角色代理场景更新结果
            for actor_agent in stage_agent.actor_agents:

                if actor_agent.is_dead:
                    logger.debug(f"💀 跳过已死亡角色 {actor_agent.name} 的通知")
                    continue

                scene_event_notification = f"""# 通知！{stage_agent.name} 场景发生事件：

## 叙事

{stage_update_result.narrative}
    
以上事件已发生并改变了场景状态，这将直接影响你的下一步观察与规划。"""

                add_actor_context(
                    actor_agent.world_id,
                    actor_agent.name,
                    [HumanMessage(content=scene_event_notification)],
                )
                logger.debug(
                    f"✅ 角色 {actor_agent.name} 收到场景更新结果通知 = \n{scene_event_notification}"
                )

            logger.info(f"✅ 场景 {stage_agent.name} 自我更新完成")

        except Exception as e:
            logger.error(f"❌ 场景 {stage_agent.name} 更新结果JSON解析错误: {e}")

    except Exception as e:
        logger.error(f"❌ 场景 {stage_agent.name} 自我更新失败: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################

#!/usr/bin/env python3
"""
游戏流水线 - 场景执行模块

负责编排角色计划并更新场景状态。
"""

import asyncio
from typing import List
from loguru import logger
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from agent_utils import GameAgentManager
from workflow_handlers import (
    handle_mcp_workflow_execution,
)
from ai_trpg.pgsql import get_stage_context, add_stage_context, add_actor_context
from ai_trpg.pgsql.stage_operations import get_stage_by_name, get_stages_in_world
from ai_trpg.pgsql.actor_plan_operations import (
    get_latest_actor_plan,
)
from ai_trpg.pgsql import ActorDB, StageDB


def _gen_compressed_stage_execute_prompt(stage_name: str, original_message: str) -> str:
    compressed_message = f"""# 指令！你（{stage_name}）场景发生事件！请输出事件内容！"""
    # logger.debug(f"{original_message}=>\n{compressed_message}")
    return compressed_message


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _build_actor_plan_prompt(actor_db: ActorDB) -> str:
    """构建角色计划提示词（优化版）

    生成格式：
    **角色名**

    - 行动计划: xxx
    - 战斗数据: 生命值 X/Y | 攻击力 Z
    - Effect: Effect1(描述), Effect2(描述) 或 无
    - 外观: xxx

    Args:
        actor_db: 角色数据库对象
        world_id: 世界ID

    Returns:
        角色计划提示词字符串
    """
    current_plan = get_latest_actor_plan(actor_db.stage.world_id, actor_db.name)
    if current_plan == "":
        return ""

    try:
        # 直接使用 ActorDB 对象的属性
        name = actor_db.name
        appearance = actor_db.appearance

        # 格式化属性
        health = actor_db.attributes.health if actor_db.attributes else 0
        max_health = actor_db.attributes.max_health if actor_db.attributes else 0
        attack = actor_db.attributes.attack if actor_db.attributes else 0

        # 格式化 Effect（紧凑型，包含名称和描述）
        if actor_db.effects:
            effect_parts = []
            for effect in actor_db.effects:
                if effect.description:
                    effect_parts.append(f"{effect.name}({effect.description})")
                else:
                    effect_parts.append(effect.name)
            effects_str = ", ".join(effect_parts)
        else:
            effects_str = "无"

        # 构建美化后的提示词
        return f"""**{name}**

- 行动计划: {current_plan}
- 战斗数据: 生命值 {health}/{max_health} | 攻击力 {attack}
- Effect: {effects_str}
- 外观: {appearance}"""

    except Exception as e:
        logger.error(f"❌ 构建角色计划提示词时发生错误: {e}")

    return ""


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _collect_actor_plan_prompts(actors: List[ActorDB]) -> List[str]:
    """收集所有角色的行动计划

    从角色数据库对象列表中提取每个角色的行动计划。

    Args:
        actors: 角色数据库对象列表
        world_id: 世界ID

    Returns:
        角色计划提示词字符串列表
    """
    ret: List[str] = []

    for actor_db in actors:
        prompt = _build_actor_plan_prompt(actor_db)
        if prompt != "":
            ret.append(prompt)

    return ret


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def _handle_single_stage_execute(
    stage_db: StageDB,
    game_agent_manager: GameAgentManager,
) -> None:
    """处理单个场景中角色的行动计划并更新场景状态

    Args:
        stage_db: 场景数据库对象(已预加载actors)
        game_agent_manager: 游戏代理管理器(用于获取mcp_client)
    """
    world_id = game_agent_manager.world_id

    # 直接使用 stage_db.actors (已通过 joinedload 预加载)
    actors = stage_db.actors
    if not actors:
        logger.warning(f"⚠️ 场景 {stage_db.name} 没有角色，跳过场景执行")
        return

    # 收集所有角色的行动计划
    actor_plans = _collect_actor_plan_prompts(actors)

    if not actor_plans:
        logger.warning(f"⚠️ 场景 {stage_db.name} 没有角色有行动计划，跳过场景执行")
        return

    # 获取 stage_agent (需要用于 MCP workflow 工具调用)
    stage_agent = game_agent_manager.get_agent_by_name(stage_db.name)
    if not stage_agent:
        logger.error(f"未找到场景代理: {stage_db.name}")
        return

    # 构建行动执行提示词（MCP Workflow 版本 - 专注于分析和工具调用）
    step1_2_instruction = f"""# 指令！你（{stage_db.name}）场景行动执行与使用工具同步状态

## 📊 输入数据

### 角色计划与信息

{"\n\n".join(actor_plans)}

### 当前角色状态

{stage_db.actor_states}

### 当前环境

{stage_db.environment}

### 当前场景连通性

{stage_db.connections}

---

## 🎯 任务流程

接收角色计划 → 内部分析 → 调用工具同步状态

---

## 📝 执行步骤

### 步骤1: 内部分析

按顺序完成以下5项分析（后续步骤依赖前置结果）：

1. **计算结果与Effect变化**
   - 战斗：基于攻击力和Effect计算伤害。新生命值 = 当前生命值 - 伤害, 更新生命值(≤0则死亡)
   - 互动：分析行动过程和影响结果
   - Effect管理：检查场景机制触发,添加新Effect或移除已消耗Effect

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
   - 只能更新已声明的连接关系，禁止编造场景名称
   - 验证移动目标是否存在：存在则正常处理，不存在则仅更新位置描述
   - 有实质性通行条件改变则更新，否则保持原值

---

### 步骤2: 调用工具

按顺序执行工具调用，保存步骤1的分析结果：

1. **同步场景状态** - 保存计算日志、叙事、角色状态、环境描述、场景连通性

2. **更新角色生命值**
   - 基于战斗计算和治疗效果更新生命值
   - 使用绝对值格式，确保数据一致性

3. **添加 Effect** - 如有新增Effect，按角色和Effect逐一调用

4. **移除 Effect** - 如有消耗Effect，按角色和Effect逐一调用

5. **移动角色到场景**
   - 验证目标场景存在于连通性声明中，存在则执行转移，不存在则仅更新位置描述
   - 确保角色状态和叙事与实际场景位置保持一致

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

    # 从数据库读取上下文
    stage_context = get_stage_context(world_id, stage_db.name)

    # 执行 MCP 工作流（改用支持工具调用的工作流，传入步骤3指令）
    await handle_mcp_workflow_execution(
        agent_name=stage_db.name,
        context=stage_context,
        request=HumanMessage(content=step1_2_instruction),
        llm=create_deepseek_llm(),
        mcp_client=stage_agent.mcp_client,  # 传入 MCP 客户端
        re_invoke_instruction=step3_instruction,  # 传入步骤3的二次推理指令
        skip_re_invoke=True,
    )

    try:
        # 执行后重新读取场景数据以获取最新的 narrative
        updated_stage = get_stage_by_name(world_id, stage_db.name)
        if not updated_stage:
            logger.error(f"执行后未找到场景: {stage_db.name}")
            return

        narrative = updated_stage.narrative

        # 批量添加场景消息到数据库
        add_stage_context(
            world_id,
            stage_db.name,
            [
                HumanMessage(
                    content=_gen_compressed_stage_execute_prompt(
                        stage_db.name, step1_2_instruction
                    )
                ),
                AIMessage(
                    content=f"""# 我（{stage_db.name}） 场景内发生事件（执行结果）如下 \n\n {narrative}"""
                ),
                HumanMessage(
                    content=f"**注意**！你（{stage_db.name}），场景信息已更新，请在下轮执行中考虑这些变化。"
                ),
            ],
        )
        logger.debug(f"✅ 场景 {stage_db.name} 执行结果 = \n{narrative}")

        # 批量通知所有角色场景执行结果
        for actor_db in actors:
            if actor_db.is_dead:
                continue

            scene_event_notification = f"""# 通知！{stage_db.name} 场景发生事件：

## 叙事

{narrative}
    
以上事件已发生并改变了场景状态，这将直接影响你的下一步观察与规划。"""

            add_actor_context(
                world_id,
                actor_db.name,
                [HumanMessage(content=scene_event_notification)],
            )
            logger.debug(
                f"✅ 角色 {actor_db.name} 收到场景执行结果通知 = \n{scene_event_notification}"
            )

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_stage_execute(
    game_agent_manager: GameAgentManager,
    use_concurrency: bool = False,
) -> None:
    """执行所有场景中角色的行动计划并更新场景状态

    Args:
        game_agent_manager: 游戏代理管理器
        use_concurrency: 是否使用并发执行
    """
    world_id = game_agent_manager.world_id

    # 一次性读取所有场景(包括预加载的actors)
    stages = get_stages_in_world(world_id)

    if use_concurrency:
        # 并发处理所有场景
        tasks = [
            _handle_single_stage_execute(stage_db, game_agent_manager)
            for stage_db in stages
        ]
        await asyncio.gather(*tasks)
    else:
        # 顺序处理所有场景
        for stage_db in stages:
            await _handle_single_stage_execute(stage_db, game_agent_manager)


########################################################################################################################
########################################################################################################################
########################################################################################################################

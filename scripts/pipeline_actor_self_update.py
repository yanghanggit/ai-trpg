#!/usr/bin/env python3
"""
游戏流水线 - 角色更新模块

负责处理角色的自我状态更新流程。
"""

import asyncio
from uuid import UUID
from loguru import logger
from langchain_core.messages import HumanMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.mcp import McpClient
from ai_trpg.agent import GameWorld
from workflow_handlers import handle_mcp_workflow_execution
from ai_trpg.pgsql import get_actor_context, get_actors_in_world, ActorDB


def _gen_self_update_request_prompt(actor_db: ActorDB) -> str:
    """
    生成角色自我状态更新请求提示词（步骤1-2：分析与工具调用）

    让LLM根据场景执行结果自主判断是否需要更新外观和添加 Effect。
    直接使用 ActorDB 对象构建提示词，无需字典转换。
    """

    # 直接访问属性（已通过 joinedload 预加载）
    health = actor_db.attributes.health
    max_health = actor_db.attributes.max_health
    attack = actor_db.attributes.attack

    # 直接遍历 effects（List[EffectDB]）
    if actor_db.effects:
        effects_list = []
        for effect in actor_db.effects:
            effects_list.append(f"- **{effect.name}**: {effect.description}")
        effects_text = "\n".join(effects_list)
    else:
        effects_text = "无"

    return f"""# 指令！你({actor_db.name}) 外观和Effect更新

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
def _gen_self_update_request_prompt_test(actor_db: ActorDB) -> str:
    """
    生成角色自我状态更新请求提示词（测试版本 - 强制更新）

    **测试用途**: 强制要求 LLM 必须更新外观和添加至少一个 Effect。
    直接使用 ActorDB 对象构建提示词，无需字典转换。
    """

    # 直接访问属性
    health = actor_db.attributes.health
    max_health = actor_db.attributes.max_health
    attack = actor_db.attributes.attack

    # 直接遍历 effects
    if actor_db.effects:
        effects_list = []
        for effect in actor_db.effects:
            effects_list.append(f"- **{effect.name}**: {effect.description}")
        effects_text = "\n".join(effects_list)
    else:
        effects_text = "无"

    return f"""# 指令！你({actor_db.name}) 外观和Effect更新（测试模式）

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
async def _handle_actor_self_update(
    actor_db: ActorDB,
    mcp_client: McpClient,
    world_id: UUID,
) -> None:
    """处理单个角色的自我状态更新

    角色根据场景执行结果（在上下文中）判断是否需要：
    1. 更新外观描述（如受伤、变化等）
    2. 添加新的 Effect（如增益、减益等）

    通过调用 MCP 工具实现状态更新。

    Args:
        actor_db: 角色数据库对象
        mcp_client: MCP 客户端
        world_id: 游戏世界 ID
    """

    # 步骤1-2: 分析与工具调用（直接使用 ActorDB 对象）
    step1_2_instruction = _gen_self_update_request_prompt(actor_db)

    # 步骤3: 二次推理输出确认（独立指令）
    step3_instruction = HumanMessage(
        content=_gen_self_update_confirmation_instruction()
    )

    # 从数据库读取上下文
    actor_context = get_actor_context(world_id, actor_db.name)

    # mcp 的工作流（传入二次推理指令）
    await handle_mcp_workflow_execution(
        agent_name=actor_db.name,
        context=actor_context,
        request=HumanMessage(content=step1_2_instruction),
        llm=create_deepseek_llm(),
        mcp_client=mcp_client,
        re_invoke_instruction=step3_instruction,  # 传入步骤3的二次推理指令
        skip_re_invoke=True,
    )


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_actors_self_update(
    game_world: GameWorld,
    use_concurrency: bool = False,
) -> None:
    """处理所有角色的自我状态更新

    从数据库获取所有存活角色，直接使用 ActorDB 对象进行更新。

    Args:
        game_world: 游戏代理管理器
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    # 从数据库获取所有存活角色（is_dead=False）
    alive_actors = get_actors_in_world(game_world.world_id, is_dead=False)

    if len(alive_actors) == 0:
        logger.warning("⚠️ 当前没有存活角色，跳过自我状态更新流程")
        return

    if use_concurrency:
        logger.debug(f"🔄 并行处理 {len(alive_actors)} 个角色的自我更新")
        actor_update_tasks = []

        for actor_db in alive_actors:
            # 通过角色名称获取对应的代理（用于获取 mcp_client）
            agent = game_world.get_agent_by_name(actor_db.name)
            assert agent is not None, f"未找到角色 {actor_db.name} 对应的代理"
            if agent:
                actor_update_tasks.append(
                    _handle_actor_self_update(
                        actor_db=actor_db,
                        mcp_client=agent.mcp_client,
                        world_id=game_world.world_id,
                    )
                )
            else:
                logger.warning(f"⚠️ 未找到角色 {actor_db.name} 对应的代理，跳过")

        await asyncio.gather(*actor_update_tasks, return_exceptions=True)

    else:
        logger.debug(f"🔄 顺序处理 {len(alive_actors)} 个角色的自我更新")

        for actor_db in alive_actors:
            # 通过角色名称获取对应的代理（用于获取 mcp_client）
            agent = game_world.get_agent_by_name(actor_db.name)
            assert agent is not None, f"未找到角色 {actor_db.name} 对应的代理"
            if agent:
                await _handle_actor_self_update(
                    actor_db=actor_db,
                    mcp_client=agent.mcp_client,
                    world_id=game_world.world_id,
                )
            else:
                logger.warning(f"⚠️ 未找到角色 {actor_db.name} 对应的代理，跳过")


########################################################################################################################
########################################################################################################################
########################################################################################################################

#!/usr/bin/env python3
"""
游戏流水线 - 观察与规划模块

负责处理角色的场景观察和行动规划流程。
"""

import asyncio
from uuid import UUID
from loguru import logger
from pydantic import BaseModel
from langchain.schema import HumanMessage, AIMessage
from ai_trpg.deepseek import create_deepseek_llm
from ai_trpg.utils.json_format import strip_json_code_block
from workflow_handlers import handle_chat_workflow_execution
from ai_trpg.pgsql import get_actor_context, add_actor_context
from ai_trpg.pgsql.actor_operations import get_actors_in_world
from ai_trpg.pgsql.actor import ActorDB
from ai_trpg.pgsql.actor_plan_operations import (
    clear_all_actor_plans,
    add_actor_plan_to_db,
)
from ai_trpg.agent import GameWorld


########################################################################################################################
########################################################################################################################
########################################################################################################################
def _gen_compressed_observe_and_plan_prompt(
    actor_name: str, original_message: str
) -> str:
    """创建压缩版本的观察与规划提示词，用于保存到历史记录

    这个压缩版本保留了提示词的结构框架（标题和输出格式要求），
    但简化了中间的详细规则说明，以减少token消耗。

    Args:
        actor_name: 角色名称
        original_message: 原始的完整提示词内容

    Returns:
        压缩后的提示词字符串
    """
    compressed_message = f"""# 指令！你（{actor_name}）开始观察，然后思考并规划行动！"""
    # logger.debug(f"{original_message}=>\n{compressed_message}")
    return compressed_message


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
async def _handle_actor_observe_and_plan(
    world_id: UUID,
    actor_db: ActorDB,
) -> None:
    """处理单个角色的观察和行动规划

    让角色从第一人称视角观察场景，并立即规划下一步行动。
    使用JSON格式输出，便于解析和后续处理。
    直接使用 ActorDB 的预加载数据，无需 MCP Resource 调用。

    Args:
        world_id: 世界ID
        actor_db: 角色数据库对象（已预加载 stage, attributes, effects 等关系）
    """
    # logger.info(f"角色观察并规划: {actor_db.name}")

    # 直接从 ActorDB 获取数据（已通过 joinedload 预加载）
    stage_db = actor_db.stage
    actor_name = actor_db.name

    # 直接格式化 effects 字符串
    if actor_db.effects:
        effect_parts = [
            f"{e.name}({e.description})" if e.description else e.name
            for e in actor_db.effects
        ]
        effects_str = ", ".join(effect_parts)
    else:
        effects_str = "无"

    # 直接格式化其他角色外观（过滤掉当前角色）
    other_actors = [a for a in stage_db.actors if a.name != actor_name]
    if other_actors:
        other_actors_parts = [
            f"**{a.name}**\n- 外观: {a.appearance}" for a in other_actors
        ]
        other_actors_str = "\n\n".join(other_actors_parts)
    else:
        other_actors_str = "无其他角色"

    observe_and_plan_prompt = f"""# 指令！你（{actor_name}）进行观察与规划行动

## 第一步: 你的角色信息 与 当前场景信息

### 你的角色信息

**{actor_name}**
- 战斗数据: 生命值 {actor_db.attributes.health}/{actor_db.attributes.max_health} | 攻击力 {actor_db.attributes.attack}
- Effect: {effects_str}
- 外观: {actor_db.appearance}

### 当前场景信息

**场景**: {stage_db.name}

**环境描述**:
{stage_db.environment}

**场景中的角色位置与状态**:
{stage_db.actor_states}

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

    # 从数据库读取上下文
    actor_context = get_actor_context(world_id, actor_name)

    actors_observe_and_plan_response = await handle_chat_workflow_execution(
        agent_name=actor_name,
        context=actor_context,
        request=HumanMessage(content=observe_and_plan_prompt),
        llm=create_deepseek_llm(),
    )

    try:

        assert len(actors_observe_and_plan_response) > 0, "角色观察与规划响应为空"

        # 步骤1: 从JSON代码块中提取字符串
        formatted_data = ActorObservationAndPlan.model_validate_json(
            strip_json_code_block(str(actors_observe_and_plan_response[-1].content))
        )

        # 批量添加两条消息到数据库
        add_actor_context(
            world_id,
            actor_name,
            [
                HumanMessage(
                    content=_gen_compressed_observe_and_plan_prompt(
                        actor_name, observe_and_plan_prompt
                    )
                ),
                AIMessage(
                    content=f"""{formatted_data.observation}\n\n{formatted_data.plan}"""
                ),
            ],
        )

        # 先清空旧计划，再保存新计划
        clear_all_actor_plans(world_id, actor_name)
        add_actor_plan_to_db(
            world_id=world_id,
            actor_name=actor_name,
            plan_content=str(formatted_data.plan),
        )
        logger.debug(f"💾 已将角色 '{actor_name}' 的计划保存到数据库")

    except Exception as e:
        logger.error(f"JSON解析错误: {e}")


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_actors_observe_and_plan(
    game_world: GameWorld,
    use_concurrency: bool = True,
) -> None:
    """处理所有角色的观察和行动规划（数据库驱动版本）

    从数据库一次性获取所有存活角色，让每个角色从第一人称视角观察场景，
    并立即规划下一步行动。使用JSON格式输出，便于解析和后续处理。

    已死亡的角色（is_dead=True）会被自动跳过（通过数据库查询过滤）。

    Args:
        world_id: 世界ID
        use_concurrency: 是否使用并行处理，默认False（顺序执行）
    """

    world_id = game_world.world_id
    assert world_id is not None, "world_id不能为空"

    # 从数据库一次性获取所有存活的角色（已预加载 stage, attributes, effects 等关系）
    alive_actors_db = get_actors_in_world(world_id=world_id, is_dead=False)

    if not alive_actors_db:
        logger.warning(f"⚠️ 世界 {world_id} 没有存活的角色需要进行观察和规划")
        return

    logger.info(
        f"🎭 世界 {world_id} 中有 {len(alive_actors_db)} 个存活角色需要观察和规划: "
        f"{', '.join([a.name for a in alive_actors_db])}"
    )

    if use_concurrency:
        # 并行处理所有角色
        logger.debug(f"🔄 并行处理 {len(alive_actors_db)} 个角色的观察和规划")
        tasks = [
            _handle_actor_observe_and_plan(
                world_id=world_id,
                actor_db=actor_db,
            )
            for actor_db in alive_actors_db
        ]
        await asyncio.gather(*tasks)
    else:
        # 顺序处理所有角色
        logger.debug(f"🔄 顺序处理 {len(alive_actors_db)} 个角色的观察和规划")
        for actor_db in alive_actors_db:
            await _handle_actor_observe_and_plan(
                world_id=world_id,
                actor_db=actor_db,
            )

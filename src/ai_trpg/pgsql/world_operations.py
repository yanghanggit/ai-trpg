"""
World 数据库操作模块

提供 Pydantic World 模型与数据库之间的转换操作:
- save_world_to_db: 保存 World 到数据库
- load_world_from_db: 从数据库加载 World
- get_world_id_by_name: 通过 world_name 获取数据库 world_id
- delete_world: 删除 World
"""

from typing import Optional, Tuple
from uuid import UUID
from loguru import logger
from ..demo.models import World
from .client import SessionLocal
from .world import WorldDB
from .stage import StageDB
from .stage_connection import StageConnectionDB
from .actor import ActorDB
from .attributes import AttributesDB
from .effect import EffectDB
from .message import MessageDB


def save_world_to_db(world: World) -> WorldDB:
    """将 Pydantic World 保存到数据库

    递归转换 World → Stage → Actor → (Attributes, Effects, Messages)

    Args:
        world: Pydantic World 模型实例

    Returns:
        WorldDB: 保存后的数据库 World 对象

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            # 1. 创建 WorldDB
            world_db = WorldDB(
                name=world.name,
                campaign_setting=world.campaign_setting,
            )

            # 1.5. 保存 World 的 context
            for idx, message in enumerate(world.context):
                message_db = MessageDB(
                    sequence=idx,
                    message_json=message.model_dump_json(),
                )
                world_db.context.append(message_db)

            # 2. 递归创建 Stages
            stage_db_map = {}  # 用于后续创建连接时查找 StageDB
            for stage in world.stages:
                stage_db = StageDB(
                    name=stage.name,
                    profile=stage.profile,
                    environment=stage.environment,
                    narrative=stage.narrative,
                    actor_states=stage.actor_states,
                    connections=stage.connections,
                )
                world_db.stages.append(stage_db)
                stage_db_map[stage.name] = stage_db  # 记录 name -> StageDB 映射

                # 2.5. 保存 Stage 的 context
                for idx, message in enumerate(stage.context):
                    message_db = MessageDB(
                        sequence=idx,
                        message_json=message.model_dump_json(),
                    )
                    stage_db.context.append(message_db)

                # 3. 递归创建 Actors
                for actor in stage.actors:
                    actor_db = ActorDB(
                        name=actor.name,
                        profile=actor.profile,
                        appearance=actor.appearance,
                    )
                    stage_db.actors.append(actor_db)

                    # 4. 创建 Attributes (一对一)
                    attributes_db = AttributesDB(
                        health=actor.attributes.health,
                        max_health=actor.attributes.max_health,
                        attack=actor.attributes.attack,
                    )
                    actor_db.attributes = attributes_db

                    # 5. 创建 Effects (一对多)
                    for effect in actor.effects:
                        effect_db = EffectDB(
                            name=effect.name,
                            description=effect.description,
                        )
                        actor_db.effects.append(effect_db)

                    # 6. 创建 Messages (initial_context)
                    for idx, message in enumerate(actor.context):
                        message_db = MessageDB(
                            sequence=idx,
                            message_json=message.model_dump_json(),
                        )
                        actor_db.context.append(message_db)

            # 6.5. 创建 StageConnections (场景图的边)
            for stage in world.stages:
                source_stage_db = stage_db_map[stage.name]

                # 遍历每个场景的连接列表
                for connection in stage.stage_connections:
                    # 查找目标场景
                    target_stage_db = stage_db_map.get(connection.target_stage_name)

                    if target_stage_db:
                        # 创建连接记录
                        connection_db = StageConnectionDB(
                            source_stage_id=source_stage_db.id,
                            target_stage_id=target_stage_db.id,
                            description=connection.description,
                        )
                        db.add(connection_db)
                    else:
                        logger.warning(
                            f"⚠️ 场景 '{stage.name}' 的连接目标 '{connection.target_stage_name}' 不存在，跳过"
                        )

            # 7. 提交到数据库
            db.add(world_db)
            db.commit()
            db.refresh(world_db)

            logger.success(
                f"✅ World '{world.name}' 已保存到数据库 (ID: {world_db.id})"
            )
            return world_db

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 保存 World '{world.name}' 失败: {e}")
            raise


def get_world_id_by_name(world_name: str) -> Optional[UUID]:
    """通过 World 名称获取数据库中的 world_id

    用于在迁移 JSON → Database 时快速获取 world_id,避免重复查询

    Args:
        world_name: World 名称 (World.name 是 UNIQUE 约束)

    Returns:
        UUID | None: 数据库中的 world_id,未找到则返回 None
    """
    with SessionLocal() as db:
        try:
            world_db = db.query(WorldDB).filter_by(name=world_name).first()
            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return None
            return world_db.id
        except Exception as e:
            logger.error(f"❌ 获取 World '{world_name}' 的 ID 失败: {e}")
            raise


def delete_world(world_name: str) -> bool:
    """从数据库删除 World

    由于 CASCADE 删除配置,会自动删除关联的 Stages/Actors/Attributes/Effects/Messages

    Args:
        world_name: World 名称

    Returns:
        bool: 删除成功返回 True,World 不存在返回 False


    WorldDB (被删除)
    ├── StageDB (CASCADE 删除)
    │   ├── ActorDB (CASCADE 删除)
    │   │   ├── AttributesDB (CASCADE 删除，一对一)
    │   │   ├── EffectDB (CASCADE 删除，一对多)
    │   │   └── MessageDB (CASCADE 删除，Actor 的对话上下文)
    │   └── MessageDB (CASCADE 删除，Stage 的对话上下文)
    └── MessageDB (CASCADE 删除，World 的对话上下文)

    """
    with SessionLocal() as db:
        try:
            world_db = db.query(WorldDB).filter_by(name=world_name).first()
            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return False

            db.delete(world_db)
            db.commit()

            logger.success(
                f"✅ World '{world_name}' 已从数据库删除 (CASCADE 删除所有关联数据)"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 删除 World '{world_name}' 失败: {e}")
            raise


def set_world_kickoff(world_name: str, kickoff: bool) -> bool:
    """设置 World 的 kickoff 状态

    Args:
        world_name: World 名称
        kickoff: kickoff 状态值

    Returns:
        bool: 设置成功返回 True,World 不存在返回 False

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            world_db = db.query(WorldDB).filter_by(name=world_name).first()
            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return False

            world_db.is_kicked_off = kickoff
            db.commit()

            logger.success(f"✅ World '{world_name}' 的 kickoff 已设置为 {kickoff}")
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 设置 World '{world_name}' 的 kickoff 失败: {e}")
            raise


def get_world_kickoff(world_name: str) -> Optional[bool]:
    """获取 World 的 kickoff 状态

    Args:
        world_name: World 名称

    Returns:
        bool | None: World 的 kickoff 状态,未找到则返回 None

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            world_db = db.query(WorldDB).filter_by(name=world_name).first()
            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return None

            return world_db.is_kicked_off

        except Exception as e:
            logger.error(f"❌ 获取 World '{world_name}' 的 kickoff 失败: {e}")
            raise


def get_world(world_name: str) -> Optional[WorldDB]:
    """获取完整的 WorldDB 对象（预加载所有关系）

    预加载层级:
    - WorldDB
      ├── stages (List[StageDB])
      │   └── actors (List[ActorDB])
      │       ├── attributes (AttributesDB)
      │       └── effects (List[EffectDB])

    Args:
        world_name: 世界名称

    Returns:
        Optional[WorldDB]: 完整的 WorldDB 对象,未找到返回 None

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            from sqlalchemy.orm import joinedload

            world_db = (
                db.query(WorldDB)
                .options(
                    # 预加载 stages 和 actors.attributes
                    joinedload(WorldDB.stages)
                    .joinedload(StageDB.actors)
                    .joinedload(ActorDB.attributes),
                    # 预加载 stages 和 actors.effects
                    joinedload(WorldDB.stages)
                    .joinedload(StageDB.actors)
                    .joinedload(ActorDB.effects),
                )
                .filter(WorldDB.name == world_name)
                .first()
            )

            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return None

            logger.debug(
                f"📋 已加载 World '{world_name}': "
                f"{len(world_db.stages)} 个 Stage, "
                f"{sum(len(s.actors) for s in world_db.stages)} 个 Actor"
            )

            return world_db

        except Exception as e:
            logger.error(f"❌ 加载 World '{world_name}' 失败: {e}")
            raise


def move_actor_to_stage(
    world_id: UUID, actor_name: str, target_stage_name: str
) -> Tuple[bool, str]:
    """将 Actor 从当前 Stage 移动到目标 Stage（纯数据库操作）

    这是一个纯粹的数据库操作函数，直接修改 ActorDB 的 stage_id 外键。
    不涉及内存中的 Pydantic 模型，所有操作都在数据库层面完成。

    Args:
        world_id: 所属世界ID
        actor_name: 要移动的角色名称
        target_stage_name: 目标场景名称

    Returns:
        Tuple[bool, str]:
            - 第一个元素: 移动是否成功
            - 第二个元素: 源场景名称（失败时返回"未知"）

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            # 1. 查找目标场景（必须属于指定世界）
            target_stage = (
                db.query(StageDB)
                .filter(StageDB.name == target_stage_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not target_stage:
                logger.error(
                    f"❌ 未找到目标场景: {target_stage_name} (世界ID: {world_id})"
                )
                return False, "未知"

            # 2. 查找角色及其当前场景（必须属于指定世界）
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not actor:
                logger.error(f"❌ 未找到角色: {actor_name} (世界ID: {world_id})")
                return False, "未知"

            # 3. 记录源场景信息（用于返回和日志）
            source_stage_name = actor.stage.name

            # 4. 幂等性检查：如果已在目标场景，直接返回成功
            if actor.stage_id == target_stage.id:
                logger.info(
                    f"✅ 角色 '{actor_name}' 已在目标场景 '{target_stage_name}'，无需移动"
                )
                return True, source_stage_name

            # 5. 执行移动：更新 Actor 的 stage_id 外键
            actor.stage_id = target_stage.id

            # 6. 提交更改
            db.commit()

            logger.success(
                f"✅ 角色 '{actor_name}' 已从场景 '{source_stage_name}' 移动到 '{target_stage_name}'"
            )
            return True, source_stage_name

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 移动角色失败: {e}")
            raise

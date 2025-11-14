"""
World 数据库操作模块

提供 Pydantic World 模型与数据库之间的转换操作:
- save_world_to_db: 保存 World 到数据库
- load_world_from_db: 从数据库加载 World
- get_world_id_by_name: 通过 world_name 获取数据库 world_id
- delete_world: 删除 World
"""

from typing import Optional, Tuple, List
from uuid import UUID
from loguru import logger

from ..demo.models import World, Stage, Actor, Attributes, Effect
from .client import SessionLocal
from .world import WorldDB
from .stage import StageDB
from .actor import ActorDB
from .attributes import AttributesDB
from .effect import EffectDB
from .message import MessageDB, messages_db_to_langchain


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


def load_world_from_db(world_name: str) -> Optional[World]:
    """从数据库加载 World

    使用 SQLAlchemy relationship 自动加载嵌套关系

    Args:
        world_name: World 名称

    Returns:
        World | None: 加载的 Pydantic World 对象,未找到则返回 None
    """
    with SessionLocal() as db:
        try:
            # 1. 查询 WorldDB (relationship 自动加载 stages)
            world_db = db.query(WorldDB).filter_by(name=world_name).first()
            if not world_db:
                logger.warning(f"⚠️ World '{world_name}' 不存在于数据库")
                return None

            # 2. 递归转换 WorldDB → World
            stages = []
            for stage_db in world_db.stages:
                actors = []
                for actor_db in stage_db.actors:
                    # 转换 Attributes
                    attributes = Attributes(
                        health=actor_db.attributes.health,
                        max_health=actor_db.attributes.max_health,
                        attack=actor_db.attributes.attack,
                    )

                    # 转换 Effects
                    effects = [
                        Effect(name=effect_db.name, description=effect_db.description)
                        for effect_db in actor_db.effects
                    ]

                    # 转换 Messages (initial_context)
                    initial_context = messages_db_to_langchain(actor_db.context)

                    # 创建 Actor
                    actor = Actor(
                        name=actor_db.name,
                        profile=actor_db.profile,
                        appearance=actor_db.appearance,
                        attributes=attributes,
                        effects=effects,
                        context=initial_context,
                    )
                    actors.append(actor)

                # 转换 Stage 的 context
                stage_context = messages_db_to_langchain(stage_db.context)

                # 创建 Stage
                stage = Stage(
                    name=stage_db.name,
                    profile=stage_db.profile,
                    environment=stage_db.environment,
                    actors=actors,
                    narrative=stage_db.narrative,
                    actor_states=stage_db.actor_states,
                    connections=stage_db.connections,
                    context=stage_context,
                )
                stages.append(stage)

            # 转换 World 的 context
            world_context = messages_db_to_langchain(world_db.context)

            # 创建 World
            world = World(
                name=world_db.name,
                campaign_setting=world_db.campaign_setting,
                stages=stages,
                context=world_context,
            )

            logger.success(f"✅ World '{world_name}' 已从数据库加载")
            return world

        except Exception as e:
            logger.error(f"❌ 加载 World '{world_name}' 失败: {e}")
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


def get_world_stages_and_actors(world_id: UUID) -> Tuple[List[StageDB], List[ActorDB]]:
    """获取指定世界中的所有 Stage 和 Actor 对象

    Args:
        world_id: 世界ID

    Returns:
        Tuple[List[StageDB], List[ActorDB]]: 包含所有 Stage 和 Actor 的元组
            - 第一个元素是 StageDB 列表
            - 第二个元素是 ActorDB 列表

    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    with SessionLocal() as db:
        try:
            # 查询所有属于该 World 的 Stage
            stages = db.query(StageDB).filter(StageDB.world_id == world_id).all()

            # 查询所有属于该 World 的 Actor（通过 Stage 关联）
            # 使用 joinedload 预加载 stage 关系，避免懒加载问题
            from sqlalchemy.orm import joinedload

            actors = (
                db.query(ActorDB)
                .options(joinedload(ActorDB.stage))
                .join(ActorDB.stage)
                .filter(StageDB.world_id == world_id)
                .all()
            )

            logger.debug(
                f"📋 查询世界 {world_id} 中的所有对象：{len(stages)} 个 Stage，{len(actors)} 个 Actor"
            )

            return stages, actors

        except Exception as e:
            logger.error(f"❌ 查询世界 Stage 和 Actor 失败: {e}")
            raise

"""
角色数据库操作模块

提供 Actor 的数据库操作
"""

from typing import Optional, List, Tuple
from uuid import UUID
from loguru import logger
from .client import SessionLocal
from .actor import ActorDB
from .attributes import AttributesDB
from .effect import EffectDB
from sqlalchemy.orm import joinedload
from .stage import StageDB


def update_actor_appearance(
    world_id: UUID, actor_name: str, new_appearance: str
) -> Optional[str]:
    """更新角色的外观描述

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        new_appearance: 新的外观描述

    Returns:
        Optional[str]: 旧的外观描述，如果角色不存在则返回 None
    """
    with SessionLocal() as db:
        try:
            # 查找角色
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.error(f"❌ 未找到角色: {actor_name} (世界ID: {world_id})")
                return None

            # 保存旧的外观描述
            old_appearance = actor.appearance

            # 更新外观描述
            actor.appearance = new_appearance

            logger.info(
                f"✨ 角色 '{actor_name}' 外观已更新\n旧外观: {old_appearance}\n\n新外观: {new_appearance}"
            )

            db.commit()
            return old_appearance

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 更新角色外观失败: {e}")
            raise


def update_actor_health(
    world_id: UUID, actor_name: str, new_health: int
) -> Optional[Tuple[int, int, int]]:
    """更新角色的生命值，如果生命值降为0则标记角色为死亡

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        new_health: 新的生命值（会被限制在 0 到 max_health 之间）

    Returns:
        Optional[Tuple[int, int, int]]: (old_health, new_health, max_health) 如果成功，否则返回 None
    """
    with SessionLocal() as db:
        try:
            # 查找角色及其属性
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.error(f"❌ 未找到角色: {actor_name} (世界ID: {world_id})")
                return None

            # 保存旧的生命值
            old_health = actor.attributes.health
            max_health = actor.attributes.max_health

            # 更新生命值：限制在 0 到 max_health 之间
            clamped_health = max(0, min(new_health, max_health))
            actor.attributes.health = clamped_health

            # 如果生命值为0，标记为死亡
            if actor.attributes.health == 0:
                actor.is_dead = True
                logger.warning(f"💀 角色 '{actor_name}' 生命值归零，已标记为死亡")
            else:
                logger.debug(
                    f"💚 角色 '{actor_name}' 生命值已更新: {actor.attributes.health}/{actor.attributes.max_health}"
                )

            db.commit()
            return (old_health, clamped_health, max_health)

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 更新角色生命值失败: {e}")
            raise


def is_actor_dead(world_id: UUID, actor_name: str) -> bool:
    """查询指定角色是否已死亡

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称

    Returns:
        bool: 角色是否已死亡，如果角色不存在则返回False
    """
    with SessionLocal() as db:
        try:
            # 查找角色
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.warning(f"⚠️ 未找到角色: {actor_name} (世界ID: {world_id})")
                return False

            is_dead = actor.is_dead
            logger.debug(
                f"📋 角色 '{actor_name}' 死亡状态: {'已死亡' if is_dead else '存活'}"
            )
            return is_dead

        except Exception as e:
            logger.error(f"❌ 查询角色死亡状态失败: {e}")
            raise


def get_actor_attributes(world_id: UUID, actor_name: str) -> Optional[AttributesDB]:
    """获取指定角色的属性信息

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称

    Returns:
        Optional[AttributesDB]: 角色的属性对象，如果角色不存在则返回None
    """
    with SessionLocal() as db:
        try:
            # 查找角色
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.warning(f"⚠️ 未找到角色: {actor_name} (世界ID: {world_id})")
                return None

            # 返回角色属性
            attributes = actor.attributes
            logger.debug(
                f"📊 角色 '{actor_name}' 属性: 生命值 {attributes.health}/{attributes.max_health}, 攻击力 {attributes.attack}"
            )
            return attributes

        except Exception as e:
            logger.error(f"❌ 查询角色属性失败: {e}")
            raise


def get_actor_by_name(world_id: UUID, actor_name: str) -> Optional[ActorDB]:
    """根据名称获取角色完整信息

    预加载 Actor 的所有关系数据，确保在会话外可以访问。

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称

    Returns:
        Optional[ActorDB]: 角色对象（预加载了 attributes 和 effects），如果不存在则返回 None
    """
    with SessionLocal() as db:
        try:
            # 查找角色并预加载关系数据
            actor = (
                db.query(ActorDB)
                .options(
                    joinedload(ActorDB.stage),
                    joinedload(ActorDB.attributes),
                    joinedload(ActorDB.effects),
                )
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.warning(f"⚠️ 未找到角色: {actor_name} (世界ID: {world_id})")
                return None

            logger.debug(f"📋 已找到角色: {actor_name}")
            return actor

        except Exception as e:
            logger.error(f"❌ 查询角色失败: {e}")
            raise


def get_actors_in_world(
    world_id: UUID, is_dead: Optional[bool] = None
) -> List[ActorDB]:
    """获取指定世界中的所有角色，可选过滤死亡状态

    预加载每个 Actor 的完整关系数据，确保在会话外可以访问。

    Args:
        world_id: 世界ID
        is_dead: 可选的死亡状态过滤条件
            - None: 返回所有角色（默认）
            - True: 只返回已死亡的角色
            - False: 只返回存活的角色

    Returns:
        List[ActorDB]: 符合条件的角色列表，每个 ActorDB 预加载了：
            - actor.stage (StageDB)
            - actor.stage.actors (List[ActorDB])
            - actor.attributes (AttributesDB)
            - actor.effects (List[EffectDB])
    """
    with SessionLocal() as db:
        try:

            # 构建基础查询：通过 Stage 关联查询 World 下的所有 Actor
            # 使用 joinedload 预加载所有需要的关系
            query = (
                db.query(ActorDB)
                .options(
                    joinedload(ActorDB.stage).joinedload(StageDB.actors),
                    joinedload(ActorDB.attributes),
                    joinedload(ActorDB.effects),
                )
                .join(ActorDB.stage)
                .filter(ActorDB.stage.has(world_id=world_id))
            )

            # 如果指定了 is_dead 过滤条件
            if is_dead is not None:
                query = query.filter(ActorDB.is_dead == is_dead)

            actors = query.all()

            # 日志输出
            status_desc = (
                "已死亡" if is_dead is True else "存活" if is_dead is False else "所有"
            )
            logger.debug(
                f"📋 查询世界 {world_id} 中的{status_desc}角色，共 {len(actors)} 个"
            )

            return actors

        except Exception as e:
            logger.error(f"❌ 查询世界角色失败: {e}")
            raise


def add_actor_effect(
    world_id: UUID, actor_name: str, effect_name: str, effect_description: str
) -> bool:
    """为角色添加一个新的效果

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        effect_name: 效果名称
        effect_description: 效果描述

    Returns:
        bool: 添加是否成功
    """
    with SessionLocal() as db:
        try:
            # 查找角色
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.error(f"❌ 未找到角色: {actor_name} (世界ID: {world_id})")
                return False

            # 创建新的效果
            new_effect = EffectDB(
                actor_id=actor.id,
                name=effect_name,
                description=effect_description,
            )

            db.add(new_effect)
            db.commit()

            logger.info(
                f"✨ 成功为角色 '{actor_name}' 添加效果: {effect_name}\n效果描述: {effect_description}"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 添加角色效果失败: {e}")
            raise


def remove_actor_effect(world_id: UUID, actor_name: str, effect_name: str) -> int:
    """移除角色身上所有匹配指定名称的效果

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        effect_name: 要移除的效果名称（所有匹配此名称的效果都会被移除）

    Returns:
        int: 移除的效果数量，如果角色不存在则返回 -1
    """
    with SessionLocal() as db:
        try:
            # 查找角色
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.error(f"❌ 未找到角色: {actor_name} (世界ID: {world_id})")
                return -1

            # 查找并删除所有匹配名称的效果
            removed_count = (
                db.query(EffectDB)
                .filter(EffectDB.actor_id == actor.id)
                .filter(EffectDB.name == effect_name)
                .delete()
            )

            db.commit()

            if removed_count > 0:
                logger.info(
                    f"🗑️ 成功从角色 '{actor_name}' 移除了 {removed_count} 个名为 '{effect_name}' 的效果"
                )
            else:
                logger.info(
                    f"ℹ️ 角色 '{actor_name}' 身上没有名为 '{effect_name}' 的效果"
                )

            return removed_count

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 移除角色效果失败: {e}")
            raise

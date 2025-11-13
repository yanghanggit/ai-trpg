"""
角色移动事件数据库操作模块

提供 ActorMovementEvent 与 Unlogged Table 之间的转换操作
"""

from typing import List
from uuid import UUID
from loguru import logger
from .client import SessionLocal
from .actor_movement_event import ActorMovementEventDB


def save_actor_movement_event_to_db(
    world_id: UUID,
    actor_name: str,
    from_stage: str,
    to_stage: str,
    description: str,
    entry_posture_and_status: str,
) -> ActorMovementEventDB:
    """保存角色移动事件到数据库

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        from_stage: 来源场景
        to_stage: 目标场景
        description: 事件描述
        entry_posture_and_status: 进入姿态与状态

    Returns:
        ActorMovementEventDB: 保存后的数据库对象
    """
    with SessionLocal() as db:
        try:
            event_db = ActorMovementEventDB(
                world_id=world_id,
                actor_name=actor_name,
                from_stage=from_stage,
                to_stage=to_stage,
                description=description,
                entry_posture_and_status=entry_posture_and_status,
            )
            db.add(event_db)
            db.commit()
            db.refresh(event_db)

            logger.debug(
                f"💾 角色移动事件已保存到数据库: {actor_name} ({from_stage} -> {to_stage})"
            )
            return event_db

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 保存角色移动事件失败: {e}")
            raise


def get_actor_movement_events_by_actor(
    world_id: UUID, actor_name: str
) -> List[ActorMovementEventDB]:
    """获取指定世界中指定角色的所有移动事件

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称

    Returns:
        List[ActorMovementEventDB]: 该角色的所有移动事件
    """
    with SessionLocal() as db:
        try:
            events = (
                db.query(ActorMovementEventDB)
                .filter_by(world_id=world_id, actor_name=actor_name)
                .order_by(ActorMovementEventDB.created_at)
                .all()
            )
            logger.debug(
                f"📖 查询到 {len(events)} 个世界 '{world_id}' 中角色 '{actor_name}' 的移动事件"
            )
            return events

        except Exception as e:
            logger.error(f"❌ 查询角色移动事件失败: {e}")
            raise


def get_actor_movement_events_by_stage(
    world_id: UUID, stage_name: str
) -> List[ActorMovementEventDB]:
    """获取指定世界中所有进入指定场景的移动事件

    Args:
        world_id: 所属世界ID
        stage_name: 场景名称

    Returns:
        List[ActorMovementEventDB]: 所有进入该场景的事件
    """
    with SessionLocal() as db:
        try:
            events = (
                db.query(ActorMovementEventDB)
                .filter_by(world_id=world_id, to_stage=stage_name)
                .order_by(ActorMovementEventDB.created_at)
                .all()
            )
            logger.debug(
                f"📖 查询到 {len(events)} 个世界 '{world_id}' 中进入场景 '{stage_name}' 的移动事件"
            )
            return events

        except Exception as e:
            logger.error(f"❌ 查询场景移动事件失败: {e}")
            raise


def clear_all_actor_movement_events(world_id: UUID) -> int:
    """清空角色移动事件

    Args:
        world_id: 世界ID。如果提供则只清除该世界的事件,否则清除所有世界的事件

    Returns:
        int: 删除的事件数量
    """
    with SessionLocal() as db:
        try:
            query = db.query(ActorMovementEventDB)
            # if world_id is not None:
            query = query.filter_by(world_id=world_id)
            count = query.count()
            query.delete()
            db.commit()
            logger.info(f"🗑️ 已清空世界 '{world_id}' 的 {count} 个角色移动事件")
            # else:
            #     count = query.count()
            #     query.delete()
            #     db.commit()
            #     logger.info(f"🗑️ 已清空所有世界的 {count} 个角色移动事件")

            return count

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 清空角色移动事件失败: {e}")
            raise

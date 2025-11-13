"""
角色计划数据库操作模块

提供 ActorPlan 的数据库操作
"""

from typing import List
from uuid import UUID
from loguru import logger
from .client import SessionLocal
from .actor_plan import ActorPlanDB


def add_actor_plan_to_db(
    world_id: UUID,
    actor_name: str,
    plan_content: str,
) -> ActorPlanDB:
    """添加角色计划到数据库

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        plan_content: 计划内容

    Returns:
        ActorPlanDB: 保存后的数据库对象
    """
    with SessionLocal() as db:
        try:
            plan_db = ActorPlanDB(
                world_id=world_id,
                actor_name=actor_name,
                plan_content=plan_content,
            )
            db.add(plan_db)
            db.commit()
            db.refresh(plan_db)

            logger.debug(
                f"💾 角色计划已保存到数据库: {actor_name} - {plan_content[:50]}..."
            )
            return plan_db

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 保存角色计划失败: {e}")
            raise


def clear_all_actor_plans(world_id: UUID, actor_name: str) -> int:
    """清空指定世界中指定角色的所有计划

    Args:
        world_id: 世界ID
        actor_name: 角色名称

    Returns:
        int: 删除的计划数量
    """
    with SessionLocal() as db:
        try:
            query = db.query(ActorPlanDB).filter_by(
                world_id=world_id, actor_name=actor_name
            )
            count = query.count()
            query.delete()
            db.commit()
            logger.info(
                f"🗑️ 已清空世界 '{world_id}' 中角色 '{actor_name}' 的 {count} 个计划"
            )
            return count

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 清空角色计划失败: {e}")
            raise


def clear_multiple_actor_plans(world_id: UUID, actor_names: List[str]) -> int:
    """批量清空指定世界中多个角色的所有计划

    Args:
        world_id: 世界ID
        actor_names: 角色名称列表

    Returns:
        int: 删除的计划总数量
    """
    with SessionLocal() as db:
        try:
            query = db.query(ActorPlanDB).filter(
                ActorPlanDB.world_id == world_id,
                ActorPlanDB.actor_name.in_(actor_names),
            )
            count = query.count()
            query.delete(synchronize_session=False)
            db.commit()
            logger.info(
                f"🗑️ 已清空世界 '{world_id}' 中 {len(actor_names)} 个角色的 {count} 个计划"
            )
            return count

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 批量清空角色计划失败: {e}")
            raise


def get_latest_actor_plan(world_id: UUID, actor_name: str) -> str:
    """获取指定角色的最新计划内容

    Args:
        world_id: 世界ID
        actor_name: 角色名称

    Returns:
        str: 最新的计划内容，如果没有计划则返回空字符串
    """
    with SessionLocal() as db:
        try:
            plan = (
                db.query(ActorPlanDB)
                .filter_by(world_id=world_id, actor_name=actor_name)
                .order_by(ActorPlanDB.created_at.desc())
                .first()
            )
            if plan:
                logger.debug(f"📖 查询到角色 '{actor_name}' 的最新计划")
                return plan.plan_content
            return ""
        except Exception as e:
            logger.error(f"❌ 查询角色计划失败: {e}")
            raise

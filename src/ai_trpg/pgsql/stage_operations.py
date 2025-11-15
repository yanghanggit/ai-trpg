"""
场景数据库操作模块

提供 Stage 的数据库操作
"""

from typing import Optional, List
from uuid import UUID
from loguru import logger
from sqlalchemy.orm import joinedload
from .client import SessionLocal
from .stage import StageDB
from .actor import ActorDB


def update_stage_info(
    world_id: UUID,
    stage_name: str,
    environment: Optional[str] = None,
    narrative: Optional[str] = None,
    actor_states: Optional[str] = None,
    connections: Optional[str] = None,
) -> bool:
    """更新场景的信息字段

    Args:
        world_id: 所属世界ID
        stage_name: 场景名称
        environment: 环境描述（可选）
        narrative: 叙事文本（可选）
        actor_states: 角色状态信息（可选）
        connections: 连接信息（可选）

    Returns:
        bool: 更新是否成功
    """
    with SessionLocal() as db:
        try:
            # 查找场景
            stage = (
                db.query(StageDB)
                .filter(StageDB.name == stage_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not stage:
                logger.error(f"❌ 未找到场景: {stage_name} (世界ID: {world_id})")
                return False

            # 更新提供的字段
            updated_fields = []

            if environment is not None:
                stage.environment = environment
                updated_fields.append("environment")

            if narrative is not None:
                stage.narrative = narrative
                updated_fields.append("narrative")

            if actor_states is not None:
                stage.actor_states = actor_states
                updated_fields.append("actor_states")

            if connections is not None:
                stage.connections = connections
                updated_fields.append("connections")

            if not updated_fields:
                logger.warning(f"⚠️ 未提供任何要更新的字段")
                return False

            db.commit()
            logger.debug(
                f"✅ 场景 '{stage_name}' 已更新字段: {', '.join(updated_fields)}"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 更新场景信息失败: {e}")
            raise


def get_stage_by_name(world_id: UUID, stage_name: str) -> Optional[StageDB]:
    """根据名称获取场景信息

    Args:
        world_id: 所属世界ID
        stage_name: 场景名称

    Returns:
        Optional[StageDB]: 场景对象，如果不存在则返回None
    """
    with SessionLocal() as db:
        try:
            stage = (
                db.query(StageDB)
                .filter(StageDB.name == stage_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not stage:
                logger.warning(f"⚠️ 未找到场景: {stage_name} (世界ID: {world_id})")
                return None

            logger.debug(f"📋 已找到场景: {stage_name}")
            return stage

        except Exception as e:
            logger.error(f"❌ 查询场景失败: {e}")
            raise


def get_stages_in_world(world_id: UUID) -> List[StageDB]:
    """获取指定世界中的所有场景

    预加载每个 Stage 的角色列表及其关联数据，确保在会话外可以访问。

    Args:
        world_id: 世界ID

    Returns:
        List[StageDB]: 该世界中的所有场景列表，每个 StageDB 预加载了：
            - stage.actors (List[ActorDB])
            - actors.attributes (AttributesDB)
            - actors.effects (List[EffectDB])
    """
    with SessionLocal() as db:
        try:
            # 查询所有场景并预加载角色列表及其关联数据
            stages = (
                db.query(StageDB)
                .options(
                    joinedload(StageDB.actors).joinedload(ActorDB.attributes),
                    joinedload(StageDB.actors).joinedload(ActorDB.effects),
                )
                .filter(StageDB.world_id == world_id)
                .all()
            )

            logger.debug(f"📋 查询世界 {world_id} 中的所有场景，共 {len(stages)} 个")
            return stages

        except Exception as e:
            logger.error(f"❌ 查询世界场景失败: {e}")
            raise

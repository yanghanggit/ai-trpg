"""
角色数据库操作模块

提供 Actor 的数据库操作
"""

from uuid import UUID
from loguru import logger
from .client import SessionLocal
from .actor import ActorDB


def update_actor_health(world_id: UUID, actor_name: str, new_health: int) -> bool:
    """更新角色的生命值，如果生命值降为0则标记角色为死亡

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        new_health: 新的生命值

    Returns:
        bool: 更新是否成功
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
                return False

            # 更新生命值
            actor.attributes.health = max(0, new_health)  # 确保生命值不为负

            # 如果生命值为0，标记为死亡
            if actor.attributes.health == 0:
                actor.is_dead = True
                logger.warning(f"💀 角色 '{actor_name}' 生命值归零，已标记为死亡")
            else:
                logger.debug(
                    f"💚 角色 '{actor_name}' 生命值已更新: {actor.attributes.health}/{actor.attributes.max_health}"
                )

            db.commit()
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 更新角色生命值失败: {e}")
            raise

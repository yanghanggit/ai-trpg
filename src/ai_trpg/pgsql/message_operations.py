"""
消息数据库操作模块

提供 MessageDB 的操作函数，用于管理 Actor/Stage/World 的 LLM 对话上下文
"""

from typing import List, Optional
from uuid import UUID
from langchain_core.messages import BaseMessage, SystemMessage
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

from .client import SessionLocal
from .message import MessageDB, messages_db_to_langchain
from .actor import ActorDB
from .stage import StageDB
from .world import WorldDB


def get_actor_context(world_id: UUID, actor_name: str) -> List[BaseMessage]:
    """读取指定 Actor 的对话上下文消息列表

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称

    Returns:
        List[BaseMessage]: Actor 的对话上下文消息列表，按 sequence 排序
                          如果 Actor 不存在或无消息，返回空列表
    """
    with SessionLocal() as db:
        try:
            # 查找 Actor
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == actor_name)
                .filter(ActorDB.stage.has(world_id=world_id))
                .first()
            )

            if not actor:
                logger.warning(f"⚠️ 未找到角色: {actor_name} (世界ID: {world_id})")
                return []

            # 转换 MessageDB → BaseMessage
            context = messages_db_to_langchain(actor.context)
            assert len(context) > 0 and isinstance(
                context[0], SystemMessage
            ), "Actor 上下文的第一条消息必须是 SystemMessage"
            logger.debug(
                f"📨 读取角色 '{actor_name}' 的对话上下文: {len(context)} 条消息"
            )
            return context

        except Exception as e:
            logger.error(f"❌ 读取角色对话上下文失败: {e}")
            raise


def get_stage_context(world_id: UUID, stage_name: str) -> List[BaseMessage]:
    """读取指定 Stage 的对话上下文消息列表

    Args:
        world_id: 所属世界ID
        stage_name: 场景名称

    Returns:
        List[BaseMessage]: Stage 的对话上下文消息列表，按 sequence 排序
                          如果 Stage 不存在或无消息，返回空列表
    """
    with SessionLocal() as db:
        try:
            # 查找 Stage
            stage = (
                db.query(StageDB)
                .filter(StageDB.name == stage_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not stage:
                logger.warning(f"⚠️ 未找到场景: {stage_name} (世界ID: {world_id})")
                return []

            # 转换 MessageDB → BaseMessage
            context = messages_db_to_langchain(stage.context)
            assert len(context) > 0 and isinstance(
                context[0], SystemMessage
            ), "Stage 上下文的第一条消息必须是 SystemMessage"
            logger.debug(
                f"📨 读取场景 '{stage_name}' 的对话上下文: {len(context)} 条消息"
            )
            return context

        except Exception as e:
            logger.error(f"❌ 读取场景对话上下文失败: {e}")
            raise


def get_world_context(world_id: UUID) -> List[BaseMessage]:
    """读取指定 World 的对话上下文消息列表

    Args:
        world_id: 世界ID

    Returns:
        List[BaseMessage]: World 的对话上下文消息列表，按 sequence 排序
                          如果 World 不存在或无消息，返回空列表
    """
    with SessionLocal() as db:
        try:
            # 查找 World
            world = db.query(WorldDB).filter(WorldDB.id == world_id).first()

            if not world:
                logger.warning(f"⚠️ 未找到世界: (ID: {world_id})")
                return []

            # 转换 MessageDB → BaseMessage
            context = messages_db_to_langchain(world.context)
            assert len(context) > 0 and isinstance(
                context[0], SystemMessage
            ), "World 上下文的第一条消息必须是 SystemMessage"
            logger.debug(
                f"📨 读取世界 '{world.name}' 的对话上下文: {len(context)} 条消息"
            )
            return context

        except Exception as e:
            logger.error(f"❌ 读取世界对话上下文失败: {e}")
            raise


def add_actor_context(
    world_id: UUID, actor_name: str, messages: List[BaseMessage]
) -> bool:
    """添加新的对话消息到指定 Actor 的上下文

    Args:
        world_id: 所属世界ID
        actor_name: 角色名称
        messages: 要添加的消息列表

    Returns:
        bool: 添加成功返回 True，Actor 不存在返回 False
    """

    with SessionLocal() as db:
        try:
            # 查找 Actor
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

            # 添加消息（自动计算 sequence 并提交）
            _add_messages_to_db(db, messages, actor_id=actor.id)
            db.commit()
            logger.success(
                f"✅ 已为角色 '{actor_name}' 添加 {len(messages)} 条对话消息"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 添加角色对话消息失败: {e}")
            raise


def add_stage_context(
    world_id: UUID, stage_name: str, messages: List[BaseMessage]
) -> bool:
    """添加新的对话消息到指定 Stage 的上下文

    Args:
        world_id: 所属世界ID
        stage_name: 场景名称
        messages: 要添加的消息列表

    Returns:
        bool: 添加成功返回 True，Stage 不存在返回 False
    """

    with SessionLocal() as db:
        try:
            # 查找 Stage
            stage = (
                db.query(StageDB)
                .filter(StageDB.name == stage_name)
                .filter(StageDB.world_id == world_id)
                .first()
            )

            if not stage:
                logger.error(f"❌ 未找到场景: {stage_name} (世界ID: {world_id})")
                return False

            # 添加消息（自动计算 sequence 并提交）
            _add_messages_to_db(db, messages, stage_id=stage.id)
            db.commit()
            logger.success(
                f"✅ 已为场景 '{stage_name}' 添加 {len(messages)} 条对话消息"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 添加场景对话消息失败: {e}")
            raise


def add_world_context(world_id: UUID, messages: List[BaseMessage]) -> bool:
    """添加新的对话消息到指定 World 的上下文

    Args:
        world_id: 世界ID
        messages: 要添加的消息列表

    Returns:
        bool: 添加成功返回 True，World 不存在返回 False
    """

    with SessionLocal() as db:
        try:
            # 查找 World
            world = db.query(WorldDB).filter(WorldDB.id == world_id).first()

            if not world:
                logger.error(f"❌ 未找到世界: (ID: {world_id})")
                return False

            # 添加消息（自动计算 sequence 并提交）
            _add_messages_to_db(db, messages, world_id=world_id)
            db.commit()
            logger.success(
                f"✅ 已为世界 '{world.name}' 添加 {len(messages)} 条对话消息"
            )
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"❌ 添加世界对话消息失败: {e}")
            raise


# ============================================================================
# 私有辅助函数
# ============================================================================


def _add_messages_to_db(
    db: Session,
    messages: List[BaseMessage],
    world_id: Optional[UUID] = None,
    stage_id: Optional[UUID] = None,
    actor_id: Optional[UUID] = None,
) -> None:
    """批量添加消息到数据库（自动计算 sequence）

    在同一事务中完成：
    1. 查询当前最大 sequence
    2. 批量添加消息（sequence 自动递增）

    Args:
        db: 数据库会话
        messages: 要添加的消息列表
        world_id: World ID (三选一)
        stage_id: Stage ID (三选一)
        actor_id: Actor ID (三选一)

    Raises:
        ValueError: 当未指定或指定多个 ID 时抛出
    """
    # 1. 获取下一个可用的 sequence
    query = select(MessageDB.sequence)

    if world_id is not None:
        query = query.where(MessageDB.world_id == world_id)
    elif stage_id is not None:
        query = query.where(MessageDB.stage_id == stage_id)
    elif actor_id is not None:
        query = query.where(MessageDB.actor_id == actor_id)
    else:
        raise ValueError("必须指定 world_id, stage_id 或 actor_id 中的一个")

    query = query.order_by(MessageDB.sequence.desc())
    max_sequence = db.execute(query).scalars().first()
    start_sequence = (max_sequence + 1) if max_sequence is not None else 0

    # 2. 批量添加消息
    for idx, message in enumerate(messages):
        message_db = MessageDB(
            sequence=start_sequence + idx,
            message_json=message.model_dump_json(),
            world_id=world_id,
            stage_id=stage_id,
            actor_id=actor_id,
        )
        db.add(message_db)

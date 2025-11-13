from datetime import datetime
from uuid import UUID
from sqlalchemy import String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from .base import UUIDBase


class ActorMovementEventDB(UUIDBase):
    """角色移动事件表（Unlogged Table，用于临时事件记录）"""

    __tablename__ = "actor_movement_events"

    # 外键：绑定到 World
    world_id: Mapped[UUID] = mapped_column(
        ForeignKey("worlds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属世界ID",
    )

    actor_name: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True, comment="角色名称"
    )
    from_stage: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="来源场景名称"
    )
    to_stage: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True, comment="目标场景名称"
    )
    description: Mapped[str] = mapped_column(Text, nullable=False, comment="事件描述")
    entry_posture_and_status: Mapped[str] = mapped_column(
        Text, default="", comment="进入姿态与状态"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, nullable=False, comment="事件创建时间"
    )

    # 表约束和索引
    __table_args__ = (
        Index("idx_world_actor", "world_id", "actor_name"),  # 复合索引:按世界查询角色
        Index("idx_world_stage", "world_id", "to_stage"),  # 复合索引:按世界查询场景
        {"prefixes": ["UNLOGGED"]},  # 声明为 unlogged table (必须是最后一个元素)
    )

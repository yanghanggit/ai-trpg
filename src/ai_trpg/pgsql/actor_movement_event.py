from datetime import datetime
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from .base import UUIDBase


class ActorMovementEventDB(UUIDBase):
    """角色移动事件表（Unlogged Table，用于临时事件记录）"""

    __tablename__ = "actor_movement_events"
    __table_args__ = {"prefixes": ["UNLOGGED"]}  # 声明为 unlogged table

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

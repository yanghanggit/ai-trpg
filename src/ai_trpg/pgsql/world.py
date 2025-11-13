from datetime import datetime
from typing import TYPE_CHECKING, List
from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .stage import StageDB
    from .message import MessageDB


class WorldDB(UUIDBase):
    """游戏世界表"""

    __tablename__ = "worlds"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    campaign_setting: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # 关系：一个World有多个Stage
    stages: Mapped[List["StageDB"]] = relationship(
        "StageDB", back_populates="world", cascade="all, delete-orphan"
    )
    # 关系：World 的 LLM 对话上下文
    context: Mapped[List["MessageDB"]] = relationship(
        "MessageDB",
        back_populates="world",
        cascade="all, delete-orphan",
        order_by="MessageDB.sequence",
        foreign_keys="MessageDB.world_id",
    )

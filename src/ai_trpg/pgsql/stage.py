from typing import TYPE_CHECKING, List
from uuid import UUID
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .actor import ActorDB
    from .world import WorldDB
    from .message import MessageDB


class StageDB(UUIDBase):
    """场景表"""

    __tablename__ = "stages"

    # 外键：从属于哪个World
    world_id: Mapped[UUID] = mapped_column(
        ForeignKey("worlds.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    profile: Mapped[str] = mapped_column(Text, nullable=False)
    environment: Mapped[str] = mapped_column(Text, nullable=False)
    narrative: Mapped[str] = mapped_column(Text, nullable=False)
    actor_states: Mapped[str] = mapped_column(Text, nullable=False)
    connections: Mapped[str] = mapped_column(Text, default="")

    # 关系
    world: Mapped["WorldDB"] = relationship("WorldDB", back_populates="stages")
    actors: Mapped[List["ActorDB"]] = relationship(
        "ActorDB", back_populates="stage", cascade="all, delete-orphan"
    )
    # 关系：Stage 的 LLM 对话上下文
    context: Mapped[List["MessageDB"]] = relationship(
        "MessageDB",
        back_populates="stage",
        cascade="all, delete-orphan",
        order_by="MessageDB.sequence",
        foreign_keys="MessageDB.stage_id",
    )

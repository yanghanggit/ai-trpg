from typing import TYPE_CHECKING, List
from uuid import UUID
from sqlalchemy import String, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .effect import EffectDB
    from .stage import StageDB
    from .message import MessageDB
    from .attributes import AttributesDB


class ActorDB(UUIDBase):
    """角色表"""

    __tablename__ = "actors"

    # 外键：从属于哪个Stage
    stage_id: Mapped[UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    profile: Mapped[str] = mapped_column(Text, nullable=False)
    appearance: Mapped[str] = mapped_column(Text, nullable=False)
    is_dead: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 关系
    stage: Mapped["StageDB"] = relationship("StageDB", back_populates="actors")
    attributes: Mapped["AttributesDB"] = relationship(
        "AttributesDB",
        back_populates="actor",
        cascade="all, delete-orphan",
        uselist=False,
    )
    effects: Mapped[List["EffectDB"]] = relationship(
        "EffectDB", back_populates="actor", cascade="all, delete-orphan"
    )
    context: Mapped[List["MessageDB"]] = relationship(
        "MessageDB",
        back_populates="actor",
        cascade="all, delete-orphan",
        order_by="MessageDB.sequence",
        foreign_keys="MessageDB.actor_id",
    )

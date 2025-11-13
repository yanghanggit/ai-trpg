from typing import TYPE_CHECKING
from uuid import UUID
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .actor import ActorDB


class EffectDB(UUIDBase):
    """效果表"""

    __tablename__ = "effects"

    # 外键：从属于哪个Actor
    actor_id: Mapped[UUID] = mapped_column(
        ForeignKey("actors.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # 关系
    actor: Mapped["ActorDB"] = relationship("ActorDB", back_populates="effects")

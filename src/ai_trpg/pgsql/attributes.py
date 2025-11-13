from typing import TYPE_CHECKING
from uuid import UUID
from sqlalchemy import Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .actor import ActorDB


class AttributesDB(UUIDBase):
    """角色属性表 - 存储 Actor 的游戏属性"""

    __tablename__ = "attributes"

    # 外键：属于哪个 Actor (一对一关系)
    actor_id: Mapped[UUID] = mapped_column(
        ForeignKey("actors.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # 属性字段
    health: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    max_health: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    attack: Mapped[int] = mapped_column(Integer, default=10, nullable=False)

    # 关系 (一对一)
    actor: Mapped["ActorDB"] = relationship("ActorDB", back_populates="attributes")

    # 表约束：确保 actor_id 唯一 (一对一关系)
    __table_args__ = (UniqueConstraint("actor_id", name="uq_attributes_actor"),)

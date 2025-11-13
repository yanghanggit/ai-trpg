from typing import TYPE_CHECKING, Optional
from uuid import UUID
from sqlalchemy import Text, Integer, ForeignKey, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .actor import ActorDB
    from .stage import StageDB
    from .world import WorldDB


class MessageDB(UUIDBase):
    """消息表 - 存储 World/Stage/Actor 的 LLM 对话上下文"""

    __tablename__ = "messages"

    # 外键：三选一 (World/Stage/Actor)
    world_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("worlds.id", ondelete="CASCADE"), nullable=True
    )
    stage_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=True
    )
    actor_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("actors.id", ondelete="CASCADE"), nullable=True
    )

    # 消息顺序 (关键!)
    sequence: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="消息在对话中的顺序,从0开始"
    )

    # 单个 BaseMessage 的 JSON 序列化字符串
    message_json: Mapped[str] = mapped_column(
        Text, nullable=False, comment="BaseMessage.dict() 的 JSON 序列化结果"
    )

    # 关系
    world: Mapped[Optional["WorldDB"]] = relationship(
        "WorldDB", back_populates="context"
    )
    stage: Mapped[Optional["StageDB"]] = relationship(
        "StageDB", back_populates="context"
    )
    actor: Mapped[Optional["ActorDB"]] = relationship(
        "ActorDB", back_populates="context"
    )

    # 表约束
    __table_args__ = (
        # 确保三选一：必须且只能指定一个外键
        CheckConstraint(
            "(world_id IS NOT NULL)::int + (stage_id IS NOT NULL)::int + (actor_id IS NOT NULL)::int = 1",
            name="ck_one_owner",
        ),
        # World 的 sequence 唯一
        UniqueConstraint("world_id", "sequence", name="uq_world_sequence"),
        # Stage 的 sequence 唯一
        UniqueConstraint("stage_id", "sequence", name="uq_stage_sequence"),
        # Actor 的 sequence 唯一
        UniqueConstraint("actor_id", "sequence", name="uq_actor_sequence"),
    )

from datetime import datetime
from uuid import UUID
from sqlalchemy import String, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from .base import UUIDBase


class ActorPlanDB(UUIDBase):
    """角色计划表"""

    __tablename__ = "actor_plans"

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

    plan_content: Mapped[str] = mapped_column(
        String(1024), nullable=False, comment="计划内容"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, nullable=False, comment="计划创建时间"
    )

    # 表约束和索引
    __table_args__ = (
        Index(
            "idx_world_actor_plan", "world_id", "actor_name"
        ),  # 复合索引:按世界查询角色计划
        {"prefixes": ["UNLOGGED"]},  # 声明为 unlogged table (必须是最后一个元素)
    )

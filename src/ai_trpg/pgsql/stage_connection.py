"""
场景连接数据模型

定义场景之间的连接关系（图的边）。
"""

from typing import TYPE_CHECKING
from uuid import UUID
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .stage import StageDB


class StageConnectionDB(UUIDBase):
    """场景连接表 - 表示场景图的边

    设计理念：
    - 极简结构，只包含图的拓扑关系（有向边）
    - 用于支持图遍历和寻路算法（如 PostgreSQL CTE 递归查询）

    使用方式：
    - 双向门需要创建2条记录（A->B 和 B->A）
    - 游戏逻辑和通行条件由 Stage.connections 字段的自然语言描述提供给 LLM
    """

    __tablename__ = "stage_connections"

    # 图的拓扑结构：有向边
    source_stage_id: Mapped[UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=False
    )
    target_stage_id: Mapped[UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=False
    )

    # 关系
    source_stage: Mapped["StageDB"] = relationship(
        "StageDB",
        foreign_keys=[source_stage_id],
        back_populates="outgoing_connections",
    )
    target_stage: Mapped["StageDB"] = relationship(
        "StageDB",
        foreign_keys=[target_stage_id],
        back_populates="incoming_connections",
    )

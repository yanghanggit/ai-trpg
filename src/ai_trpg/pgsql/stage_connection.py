"""
场景连接数据模型

定义场景之间的连接关系（图的边）。
"""

from typing import TYPE_CHECKING
from uuid import UUID
from sqlalchemy import Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import UUIDBase

if TYPE_CHECKING:
    from .stage import StageDB


class StageConnectionDB(UUIDBase):
    """场景连接表 - 表示场景图的边

    设计理念：
    - 极简结构，只包含图的拓扑关系和LLM用的自然语言描述
    - 所有游戏逻辑（通行条件、双向性等）都通过description传递给LLM
    - 充分利用LLM的自然语言理解能力，最小化硬编码规则

    使用方式：
    - 双向门需要创建2条记录（A->B 和 B->A）
    - description应该明确说明双向关系和通行条件
    - 更新时需要同时更新两条记录以保持一致性
    """

    __tablename__ = "stage_connections"

    # 图的拓扑结构：有向边
    source_stage_id: Mapped[UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=False
    )
    target_stage_id: Mapped[UUID] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=False
    )

    # LLM用的自然语言描述（所有游戏逻辑都在这里）
    description: Mapped[str] = mapped_column(Text, nullable=False)

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

"""游戏代理模型实现"""

from typing import List, override
from uuid import UUID
from langchain_core.messages import BaseMessage

from .base import AbstractGameAgent
from ..mcp import McpClient
from ..pgsql import (
    get_world_context,
    get_stage_context,
    get_actor_context,
    add_world_context,
    add_stage_context,
    add_actor_context,
)


class GameAgent(AbstractGameAgent):
    """游戏代理模型"""

    def __init__(self, name: str, mcp_client: McpClient, world_id: UUID) -> None:
        """初始化游戏代理

        Args:
            name: 代理名称
            mcp_client: MCP 客户端实例
            world_id: 世界 ID
        """
        self.name = name
        self.mcp_client = mcp_client
        self.world_id = world_id

    @override
    def get_context(self) -> List[BaseMessage]:
        """获取代理的上下文消息（从数据库读取）

        Returns:
            List[BaseMessage]: 该代理的上下文消息列表
        """
        if isinstance(self, WorldAgent):
            return get_world_context(self.world_id)
        elif isinstance(self, StageAgent):
            return get_stage_context(self.world_id, self.name)
        elif isinstance(self, ActorAgent):
            return get_actor_context(self.world_id, self.name)
        else:
            raise TypeError(f"未知的代理类型: {type(self)}")

    @override
    def add_context(self, messages: List[BaseMessage]) -> None:
        """添加消息到代理的上下文（写入数据库）

        Args:
            messages: 要添加的消息列表
        """
        if isinstance(self, WorldAgent):
            add_world_context(self.world_id, messages)
        elif isinstance(self, StageAgent):
            add_stage_context(self.world_id, self.name, messages)
        elif isinstance(self, ActorAgent):
            add_actor_context(self.world_id, self.name, messages)
        else:
            raise TypeError(f"未知的代理类型: {type(self)}")


class WorldAgent(GameAgent):
    """世界代理

    代表整个游戏世界的代理，负责世界观、全局规则和世界状态的管理。
    """

    pass


class ActorAgent(GameAgent):
    """角色代理

    代表游戏中的单个角色，负责角色的行为、对话和状态管理。
    """

    pass


class StageAgent(GameAgent):
    """场景代理

    代表游戏中的场景，负责场景内的环境、事件和角色交互管理。
    """

    pass

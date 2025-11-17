"""游戏代理抽象基类"""

from abc import ABC, abstractmethod
from typing import List
from langchain.schema import BaseMessage


class AbstractGameAgent(ABC):
    """游戏代理抽象基类

    定义所有游戏代理必须实现的接口。
    """

    @abstractmethod
    def get_context(self) -> List[BaseMessage]:
        """获取代理的上下文消息（从数据库读取）

        Returns:
            List[BaseMessage]: 该代理的上下文消息列表
        """
        pass

    @abstractmethod
    def add_context(self, messages: List[BaseMessage]) -> None:
        """添加消息到代理的上下文（写入数据库）

        Args:
            messages: 要添加的消息列表
        """
        pass

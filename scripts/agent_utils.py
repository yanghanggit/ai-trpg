#!/usr/bin/env python3
"""
代理工具模块

提供游戏代理相关的工具函数，包括代理切换、管理等功能。
"""

import asyncio
from abc import ABC, abstractmethod
from typing import List, Optional, override
from loguru import logger
from langchain.schema import BaseMessage
from ai_trpg.mcp import (
    McpClient,
)
from uuid import UUID
from ai_trpg.pgsql import (
    get_world_context,
    get_stage_context,
    get_actor_context,
    add_world_context,
    add_stage_context,
    add_actor_context,
)


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


class GameWorld:
    """游戏代理管理器

    统一管理所有类型的游戏代理，提供类型安全的访问接口。
    保持现有的执行逻辑不变，同时提供更清晰的代理管理功能。
    """

    def __init__(self) -> None:
        """初始化代理管理器"""
        self._world_agent: Optional[WorldAgent] = None
        self._stage_agents: List[StageAgent] = []
        self._actor_agents: List[ActorAgent] = []
        self._current_agent: Optional[GameAgent] = None
        self._world_name: str = ""
        self._world_id: Optional[UUID] = None

    async def load(
        self,
        world_name: str,
    ) -> None:
        """从数据库加载 WorldDB 并创建所有代理

        Args:
            world_name: 世界名称
        """
        logger.debug("🏗️ 开始创建游戏代理...")

        # 从数据库加载完整的 WorldDB (预加载所有关系)
        from ai_trpg.pgsql import get_world

        world_db = get_world(world_name)
        if not world_db:
            raise ValueError(f"World '{world_name}' 不存在于数据库")

        # 保存世界信息
        self._world_name = world_db.name
        self._world_id = world_db.id
        logger.debug(f"✅ 世界名称: {self._world_name}")
        logger.debug(f"✅ 世界 ID: {self._world_id}")

        # 创建世界观代理
        self._world_agent = WorldAgent(
            name=world_db.name,
            mcp_client=await self._create_mcp_client(),
            world_id=self._world_id,
        )
        logger.debug(f"已创建世界观代理: {self._world_agent.name}")

        # 创建场景代理和角色代理
        self._stage_agents = []
        self._actor_agents = []

        for stage_db in world_db.stages:
            # 创建场景代理
            stage_agent = StageAgent(
                name=stage_db.name,
                mcp_client=await self._create_mcp_client(),
                world_id=self._world_id,
            )
            self._stage_agents.append(stage_agent)
            logger.debug(f"已创建场景代理: {stage_agent.name}")

            # 直接使用 stage_db.actors (已预加载 attributes 和 effects)
            for actor_db in stage_db.actors:
                actor_agent = ActorAgent(
                    name=actor_db.name,
                    mcp_client=await self._create_mcp_client(),
                    world_id=self._world_id,
                )
                self._actor_agents.append(actor_agent)
                logger.debug(
                    f"已创建角色代理: {actor_agent.name} (所属场景: {stage_agent.name})"
                )

        # 默认激活世界观代理
        self._current_agent = self._world_agent
        assert self._current_agent is not None, "当前激活的代理不能为空"

        logger.debug("✅ 所有游戏代理创建完成")

    async def _create_mcp_client(self) -> McpClient:

        from ai_trpg.mcp import (
            mcp_config,
        )
        from mcp_client_init import create_mcp_client_with_config

        return await create_mcp_client_with_config(
            mcp_config=mcp_config, list_available=False, auto_connect=False
        )

    async def connect_all_agents(self) -> None:
        """并发连接所有代理的 MCP 客户端

        在 create_agents_from_world 之后调用，用于批量建立所有 MCP 连接。
        使用 asyncio.gather 实现真正的并发连接，提高效率。
        """
        logger.info("🔗 开始并发连接所有代理的 MCP 客户端...")

        # 收集所有需要连接的任务
        connection_tasks = []

        # 世界代理
        if self._world_agent:
            connection_tasks.append(self._connect_agent_client(self._world_agent))

        # 场景代理
        for stage_agent in self._stage_agents:
            connection_tasks.append(self._connect_agent_client(stage_agent))

        # 角色代理
        for actor_agent in self._actor_agents:
            connection_tasks.append(self._connect_agent_client(actor_agent))

        # 并发执行所有连接
        results = await asyncio.gather(*connection_tasks, return_exceptions=True)

        # 统计连接结果
        success_count = sum(1 for r in results if r is True)
        failure_count = sum(1 for r in results if isinstance(r, Exception))

        logger.info(
            f"✅ MCP 客户端连接完成: "
            f"成功 {success_count}/{len(connection_tasks)}, "
            f"失败 {failure_count}/{len(connection_tasks)}"
        )

        # 如果有失败，记录详细错误
        if failure_count > 0:
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"❌ 连接失败 [{i}]: {result}")

    async def _connect_agent_client(self, agent: GameAgent) -> bool:
        """连接单个代理的 MCP 客户端

        Args:
            agent: 要连接的游戏代理

        Returns:
            bool: 连接是否成功
        """
        try:
            await agent.mcp_client.connect()
            logger.debug(f"✅ 代理 [{agent.name}] MCP 客户端已连接")
            return True
        except Exception as e:
            logger.error(f"❌ 代理 [{agent.name}] MCP 客户端连接失败: {e}")
            raise

    @property
    def world_agent(self) -> Optional[WorldAgent]:
        """获取世界观代理"""
        return self._world_agent

    @property
    def world_name(self) -> str:
        """获取游戏世界名称 (用于数据库操作的 world_id 查询)"""
        assert self._world_name != "", "游戏世界名称未设置"
        return self._world_name

    @property
    def world_id(self) -> UUID:
        """获取游戏世界 ID (用于数据库操作)"""
        assert self._world_id is not None, "游戏世界 ID 未设置"
        return self._world_id

    @property
    def actor_agents(self) -> List[ActorAgent]:
        """获取所有角色代理"""
        return self._actor_agents

    @property
    def all_agents(self) -> List[GameAgent]:
        """获取所有代理"""
        agents: List[GameAgent] = []
        assert self._world_agent is not None, "世界观代理未设置"
        if self._world_agent:
            agents.append(self._world_agent)
        agents.extend(self._stage_agents)
        agents.extend(self._actor_agents)
        return agents

    @property
    def current_agent(self) -> Optional[GameAgent]:
        """获取当前激活的代理"""
        return self._current_agent

    def get_agent_by_name(self, agent_name: str) -> Optional[GameAgent]:
        """根据名称查找代理

        Args:
            agent_name: 代理名称

        Returns:
            Optional[GameAgent]: 如果找到返回对应代理，否则返回 None
        """
        for agent in self.all_agents:
            if agent.name == agent_name:
                return agent
        return None

    def switch_current_agent(self, target_name: str) -> Optional[GameAgent]:
        """切换到指定名称的代理

        Args:
            target_name: 目标代理的名称

        Returns:
            Optional[GameAgent]: 如果切换成功返回目标代理，否则返回 None
        """
        if not self._current_agent:
            logger.error("❌ 当前没有激活的代理")
            return None

        # 检查是否尝试切换到当前代理
        if target_name == self._current_agent.name:
            logger.warning(
                f"⚠️ 你已经是该角色代理 [{self._current_agent.name}]，无需切换"
            )
            return None

        # 在所有代理中查找目标代理
        for agent in self.all_agents:
            if agent.name == target_name:
                logger.success(
                    f"✅ 切换代理: [{self._current_agent.name}] → [{agent.name}]"
                )
                self._current_agent = agent
                return agent

        # 未找到目标代理
        logger.error(f"❌ 未找到角色代理: {target_name}")
        return None

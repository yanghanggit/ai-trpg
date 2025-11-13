#!/usr/bin/env python3
"""
代理工具模块

提供游戏代理相关的工具函数，包括代理切换、管理等功能。
"""

import asyncio
from typing import List, Optional, Tuple
from loguru import logger
from pydantic import BaseModel, ConfigDict
from langchain.schema import BaseMessage
from ai_trpg.demo import (
    World,
)
from langchain.schema import BaseMessage
from ai_trpg.mcp import (
    McpClient,
)


class GameAgent(BaseModel):
    """游戏代理模型"""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    mcp_client: McpClient
    context: List[BaseMessage] = []
    plan: str = ""
    is_kicked_off: bool = False  # 代理是否已完成开局初始化, 防止重复
    is_dead: bool = False  # 代理是否已死亡


class WorldAgent(GameAgent):
    """世界代理

    代表整个游戏世界的代理，负责世界观、全局规则和世界状态的管理。
    """

    pass


class ActorAgent(GameAgent):
    """角色代理

    代表游戏中的单个角色，负责角色的行为、对话和状态管理。
    """

    stage_agent: "StageAgent"  # 该角色所属的场景代理


class StageAgent(GameAgent):
    """场景代理

    代表游戏中的场景，负责场景内的环境、事件和角色交互管理。
    包含该场景中的所有角色代理列表。
    """

    actor_agents: List[ActorAgent] = []  # 该场景中的角色代理列表


class GameAgentManager:
    """游戏代理管理器

    统一管理所有类型的游戏代理，提供类型安全的访问接口。
    保持现有的执行逻辑不变，同时提供更清晰的代理管理功能。
    """

    def __init__(self) -> None:
        """初始化代理管理器"""
        self._world_agent: Optional[WorldAgent] = None
        self._stage_agents: List[StageAgent] = []
        self._current_agent: Optional[GameAgent] = None
        self._world_name: str = ""

    async def create_agents_from_world(
        self,
        world_model: World,
        # global_game_mechanics: str,
    ) -> None:
        """从游戏世界创建所有代理 - 直接创建，简单直接"""
        logger.debug("🏗️ 开始创建游戏代理...")

        # 保存世界名称 (用于后续数据库操作)
        self._world_name = world_model.name
        logger.debug(f"✅ 保存世界名称: {self._world_name}")

        # 创建世界观代理
        self._world_agent = WorldAgent(
            name=world_model.name,
            context=world_model.context,
            mcp_client=await self._create_mcp_client(),
        )
        logger.debug(f"已创建世界观代理: {self._world_agent.name}")

        # 获取游戏世界中的所有角色
        all_actors_model = world_model.get_all_actors()
        logger.debug(
            f"游戏世界中的所有角色: {[actor.name for actor in all_actors_model]}"
        )

        all_stages_model = world_model.get_all_stages()
        logger.debug(
            f"游戏世界中的所有场景: {[stage.name for stage in all_stages_model]}"
        )

        # 创建每个场景的代理，并同时创建场景中的角色代理
        self._stage_agents = []
        for stage_model in all_stages_model:
            # 创建场景代理
            stage_agent = StageAgent(
                name=stage_model.name,
                context=stage_model.context,
                mcp_client=await self._create_mcp_client(),
            )

            # 为该场景中的每个角色创建代理
            for actor_model in stage_model.actors:
                actor_agent = ActorAgent(
                    name=actor_model.name,
                    stage_agent=stage_agent,  # 创建时直接指定所属场景
                    context=actor_model.context,
                    mcp_client=await self._create_mcp_client(),
                )
                # 将角色代理添加到场景代理的列表中
                stage_agent.actor_agents.append(actor_agent)
                logger.debug(
                    f"已创建角色代理: {actor_agent.name} (所属场景: {stage_agent.name})"
                )

                logger.debug(f"已为代理 {actor_agent.name} 应用初始对话上下文")

            self._stage_agents.append(stage_agent)
            logger.debug(
                f"已创建场景代理: {stage_agent.name} (包含 {len(stage_agent.actor_agents)} 个角色)"
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

        # 场景代理和角色代理
        for stage_agent in self._stage_agents:
            connection_tasks.append(self._connect_agent_client(stage_agent))
            for actor_agent in stage_agent.actor_agents:
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
    def actor_agents(self) -> List[ActorAgent]:
        """获取所有角色代理（从所有场景中提取）"""
        all_actor_agents: List[ActorAgent] = []
        for stage_agent in self._stage_agents:
            all_actor_agents.extend(stage_agent.actor_agents)
        return all_actor_agents

    @property
    def stage_agents(self) -> List[StageAgent]:
        """获取所有场景代理"""
        return self._stage_agents

    @property
    def all_agents(self) -> List[GameAgent]:
        """获取所有代理"""
        agents: List[GameAgent] = []
        if self._world_agent:
            agents.append(self._world_agent)
        agents.extend(self.actor_agents)  # 使用属性而不是私有变量
        agents.extend(self._stage_agents)
        return agents

    @property
    def current_agent(self) -> Optional[GameAgent]:
        """获取当前激活的代理"""
        return self._current_agent

    def switch_agent(self, target_name: str) -> Optional[GameAgent]:
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

    def _find_actor_agent(
        self, actor_name: str
    ) -> Optional[Tuple[ActorAgent, StageAgent]]:
        """查找指定名称的角色代理及其所属场景

        Args:
            actor_name: 角色名称

        Returns:
            Optional[tuple[ActorAgent, StageAgent]]: 如果找到返回 (角色代理, 所属场景代理)，否则返回 None
        """
        for stage in self._stage_agents:
            for actor in stage.actor_agents:
                if actor.name == actor_name:
                    return (actor, stage)
        return None

    def _find_stage_agent(self, stage_name: str) -> Optional[StageAgent]:
        """查找指定名称的场景代理

        Args:
            stage_name: 场景名称

        Returns:
            Optional[StageAgent]: 如果找到返回场景代理，否则返回 None
        """
        for stage in self._stage_agents:
            if stage.name == stage_name:
                return stage
        return None

    def move_actor_to_stage(self, actor_name: str, target_stage_name: str) -> bool:
        """将指定角色从当前场景移动到目标场景

        执行纯粹的数据转移，不做额外的验证、通知或上下文更新。
        调用方应该在更高层处理并发控制。

        Args:
            actor_name: 要移动的角色名称
            target_stage_name: 目标场景名称

        Returns:
            bool: 移动是否成功
        """
        # 1. 查找角色代理及其当前场景
        result = self._find_actor_agent(actor_name)
        if not result:
            logger.error(f"❌ 未找到角色: {actor_name}")
            return False

        actor_agent, current_stage = result

        # 2. 检查角色是否已死亡
        if actor_agent.is_dead:
            logger.warning(f"⚠️ 角色 [{actor_name}] 已死亡，无法移动")
            return False

        # 3. 查找目标场景
        target_stage = self._find_stage_agent(target_stage_name)
        if not target_stage:
            logger.error(f"❌ 未找到目标场景: {target_stage_name}")
            return False

        # 4. 检查是否已在目标场景
        if current_stage.name == target_stage_name:
            logger.warning(
                f"⚠️ 角色 [{actor_name}] 已在场景 [{target_stage_name}]，无需移动"
            )
            return False

        # 5. 执行数据转移
        # 从当前场景移除
        current_stage.actor_agents.remove(actor_agent)

        # 添加到目标场景
        target_stage.actor_agents.append(actor_agent)

        # 更新角色的场景引用
        actor_agent.stage_agent = target_stage

        logger.debug(
            f"✅ 角色移动成功: [{actor_name}] "
            f"从 [{current_stage.name}] → [{target_stage.name}]"
        )
        return True

#!/usr/bin/env python3
"""
代理工具模块

提供游戏代理相关的工具函数，包括代理切换、管理等功能。
"""

from typing import List, Optional, Dict
from loguru import logger
from pydantic import BaseModel
from langchain.schema import BaseMessage, SystemMessage
from ai_trpg.demo import (
    World,
    gen_world_system_message,
    gen_actor_system_message,
    gen_stage_system_message,
)
from langchain.schema import BaseMessage


class GameAgent(BaseModel):
    """游戏代理模型"""

    name: str
    context: List[BaseMessage] = []
    plan: str = ""
    is_kicked_off: bool = False  # 代理是否已完成开局初始化, 防止重复
    is_dead: bool = False  # 代理是否已死亡


class GameAgentManager:
    """游戏代理管理器

    统一管理所有类型的游戏代理，提供类型安全的访问接口。
    保持现有的执行逻辑不变，同时提供更清晰的代理管理功能。
    """

    def __init__(self) -> None:
        """初始化代理管理器"""
        self._world_agent: Optional[GameAgent] = None
        self._actor_agents: List[GameAgent] = []
        self._stage_agents: List[GameAgent] = []
        self._current_agent: Optional[GameAgent] = None

    def create_agents_from_world(
        self,
        world: World,
        global_game_mechanics: str,
        actor_initial_contexts: Dict[str, List[BaseMessage]],
    ) -> None:
        """从游戏世界创建所有代理 - 直接创建，简单直接"""
        logger.info("🏗️ 开始创建游戏代理...")

        # 创建世界观代理
        self._world_agent = GameAgent(
            name=world.name,
            context=[
                SystemMessage(
                    content=gen_world_system_message(world, global_game_mechanics)
                )
            ],
        )
        logger.info(f"已创建世界观代理: {self._world_agent.name}")

        # 获取游戏世界中的所有角色
        all_actors = world.get_all_actors()
        logger.info(f"游戏世界中的所有角色: {[actor.name for actor in all_actors]}")

        all_stages = world.get_all_stages()
        logger.info(f"游戏世界中的所有场景: {[stage.name for stage in all_stages]}")

        # 创建每个角色的代理
        self._actor_agents = []
        for actor in all_actors:
            agent = GameAgent(
                name=actor.name,
                context=[
                    SystemMessage(
                        content=gen_actor_system_message(
                            actor, world, global_game_mechanics
                        )
                    )
                ],
            )
            self._actor_agents.append(agent)
            logger.info(f"已创建角色代理: {agent.name}")

        # 创建每个场景的代理
        self._stage_agents = []
        for stage in all_stages:
            agent = GameAgent(
                name=stage.name,
                context=[
                    SystemMessage(
                        content=gen_stage_system_message(
                            stage, world, global_game_mechanics
                        )
                    )
                ],
            )
            self._stage_agents.append(agent)
            logger.info(f"已创建场景代理: {agent.name}")

        # 应用初始对话上下文
        if actor_initial_contexts:
            for agent in self._actor_agents:
                if agent.name in actor_initial_contexts:
                    agent.context.extend(actor_initial_contexts[agent.name])
                    logger.debug(f"已为代理 {agent.name} 应用初始对话上下文")

        # 默认激活世界观代理
        self._current_agent = self._world_agent
        assert self._current_agent is not None, "当前激活的代理不能为空"

        logger.success("✅ 所有游戏代理创建完成")

    @property
    def world_agent(self) -> Optional[GameAgent]:
        """获取世界观代理"""
        return self._world_agent

    @property
    def actor_agents(self) -> List[GameAgent]:
        """获取所有角色代理"""
        return self._actor_agents

    @property
    def stage_agents(self) -> List[GameAgent]:
        """获取所有场景代理"""
        return self._stage_agents

    @property
    def all_agents(self) -> List[GameAgent]:
        """获取所有代理"""
        agents = []
        if self._world_agent:
            agents.append(self._world_agent)
        agents.extend(self._actor_agents)
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

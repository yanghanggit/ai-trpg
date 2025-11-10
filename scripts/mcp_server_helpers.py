#!/usr/bin/env python3
"""
MCP 服务器辅助函数模块

提供 MCP 服务器所需的辅助功能函数，包括：
- 数据解析和格式化
- World/Actor/Stage 信息获取的内部实现

这些函数被 run_game_mcp_server.py 调用。
"""

import json
from datetime import datetime
from loguru import logger
from ai_trpg.demo import World


def get_world_info_impl(world: World) -> str:
    """
    获取World信息的内部实现（辅助函数）

    Args:
        world: 游戏世界对象

    Returns:
        统一格式的JSON响应:
        {
            "data": World的完整数据或null,
            "error": 错误信息或null,
            "timestamp": ISO格式时间戳
        }
    """
    try:
        # 获取核心数据
        world_data = json.loads(world.model_dump_json(ensure_ascii=False))

        return json.dumps(
            {
                "data": world_data,
                "error": None,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"获取World信息失败: {e}")
        return json.dumps(
            {
                "data": None,
                "error": f"无法获取World数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


def get_actor_info_impl(world: World, actor_name: str) -> str:
    """
    获取Actor信息的内部实现（辅助函数）

    Args:
        world: 游戏世界对象
        actor_name: 角色名称

    Returns:
        统一格式的JSON响应:
        {
            "data": Actor的完整数据或null,
            "error": 错误信息或null,
            "timestamp": ISO格式时间戳
        }
    """
    try:
        actor, _ = world.find_actor_with_stage(actor_name)
        if actor:
            logger.info(f"获取Actor数据: {actor_name}")

            actor_data = {
                "name": actor.name,
                "appearance": actor.appearance,
                "attributes": {
                    "health": actor.attributes.health,
                    "max_health": actor.attributes.max_health,
                    "attack": actor.attributes.attack,
                },
                "effects": [effect.model_dump() for effect in actor.effects],
            }

            return json.dumps(
                {
                    "data": actor_data,
                    "error": None,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
        else:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor"
            logger.warning(error_msg)
            return json.dumps(
                {
                    "data": None,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        logger.error(f"获取Actor信息失败: {e}")
        return json.dumps(
            {
                "data": None,
                "error": f"无法获取Actor数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


def get_stage_info_impl(world: World, stage_name: str) -> str:
    """
    获取Stage信息的内部实现（辅助函数）

    Args:
        world: 游戏世界对象
        stage_name: 场景名称

    Returns:
        统一格式的JSON响应:
        {
            "data": Stage的完整数据或null,
            "error": 错误信息或null,
            "timestamp": ISO格式时间戳
        }
    """
    try:
        stage = world.find_stage(stage_name)
        if stage:
            logger.info(f"获取Stage数据: {stage_name}")
            # 构建角色外观信息列表
            actors_appearance = [
                {
                    "name": actor.name,
                    "appearance": actor.appearance,
                }
                for actor in stage.actors
            ]

            # 构建核心数据
            stage_data = {
                "name": stage.name,
                "narrative": stage.narrative,
                "environment": stage.environment,
                "actor_states": stage.actor_states,
                "actors_appearance": actors_appearance,
            }

            return json.dumps(
                {
                    "data": stage_data,
                    "error": None,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
        else:
            error_msg = f"错误：未找到名为 '{stage_name}' 的Stage"
            logger.warning(error_msg)
            return json.dumps(
                {
                    "data": None,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        logger.error(f"获取Stage信息失败: {e}")
        return json.dumps(
            {
                "data": None,
                "error": f"无法获取Stage数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

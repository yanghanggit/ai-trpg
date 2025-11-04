#!/usr/bin/env python3
"""
MCP 服务器辅助函数模块

提供 MCP 服务器所需的辅助功能函数，包括：
- 数据解析和格式化
- Actor/Stage 信息获取的内部实现

这些函数被 run_game_mcp_server.py 调用。
"""

import json
from datetime import datetime
from typing import Any, Dict, NamedTuple
from loguru import logger
from ai_trpg.demo import World


class StageStateComponents(NamedTuple):
    """场景状态组件"""

    narrative: str
    actor_states: str
    environment: str


def parse_and_format_stage_state(state_data: str) -> StageStateComponents:
    """
    解析场景状态JSON并格式化角色状态为Markdown

    将JSON格式的场景状态解析为三个独立的文本组件，
    其中角色状态会被格式化为Markdown列表格式。

    Args:
        state_data: 场景状态的JSON字符串，包含以下字段：
            - narrative: 场景叙事文本
            - actor_states: 角色状态列表
            - environment: 环境描述文本

    Returns:
        StageStateComponents: 包含三个组件的命名元组
            - narrative: 场景叙事文本
            - actor_states: Markdown格式的角色状态列表
            - environment: 环境描述文本
    """
    state_dict: Dict[str, Any] = json.loads(state_data)

    # 准备角色状态文本（格式化为Markdown）
    actor_lines = []
    for actor_state in state_dict.get("actor_states", []):
        actor_name = actor_state.get("actor_name", "未知")
        location = actor_state.get("location", "未知位置")
        posture = actor_state.get("posture", "未知姿态")
        status = actor_state.get("status", "")

        line = f"**{actor_name}**: {location} | {posture}"
        if status:
            line += f" | {status}"
        actor_lines.append(line)

    actors_text = "\n".join(actor_lines)
    environment_text = state_dict.get("environment", "")
    narrative_text = state_dict.get("narrative", "")

    return StageStateComponents(
        narrative=narrative_text, actor_states=actors_text, environment=environment_text
    )


def get_actor_info_impl(world: World, actor_name: str) -> str:
    """
    获取Actor信息的内部实现（辅助函数）

    Args:
        world: 游戏世界对象
        actor_name: 角色名称

    Returns:
        Actor的JSON数据，包含名称、外观描述和角色属性（生命值、攻击力等）
    """
    try:
        actor, _ = world.find_actor_with_stage(actor_name)
        if actor:
            logger.info(f"获取Actor数据: {actor_name}")

            result = {
                "name": actor.name,
                "appearance": actor.appearance,
                "attributes": {
                    "health": actor.attributes.health,
                    "max_health": actor.attributes.max_health,
                    "attack": actor.attributes.attack,
                },
                "effects": [effect.model_dump() for effect in actor.effects],
            }
            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor"
            logger.warning(error_msg)
            return json.dumps(
                {"error": error_msg, "timestamp": datetime.now().isoformat()},
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        logger.error(f"获取Actor信息失败: {e}")
        return json.dumps(
            {
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
        Stage的JSON数据，包含场景的所有属性（名称、叙事、环境、角色外观等）
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

            # 构建返回结果
            result = {
                "name": stage.name,
                "narrative": stage.narrative,
                "environment": stage.environment,
                "actor_states": stage.actor_states,
                "actors_appearance": actors_appearance,
            }

            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            error_msg = f"错误：未找到名为 '{stage_name}' 的Stage"
            logger.warning(error_msg)
            return json.dumps(
                {"error": error_msg, "timestamp": datetime.now().isoformat()},
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        logger.error(f"获取Stage信息失败: {e}")
        return json.dumps(
            {
                "error": f"无法获取Stage数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

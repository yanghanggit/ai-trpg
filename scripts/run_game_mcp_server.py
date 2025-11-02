#!/usr/bin/env python3
"""
Game MCP 服务器 - 简化版 MCP 服务器实现

基于 MCP 2025-06-18 规范的 Streamable HTTP 传输实现。

功能：
1. 提供游戏数据查询工具
2. 提供静态和动态资源访问
3. 提供游戏场景提示词模板

使用方法：
    python scripts/run_game_mcp_server.py
"""

import os
import sys

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

import json
from datetime import datetime
from urllib.parse import unquote
from loguru import logger
from mcp.server.fastmcp import FastMCP
import mcp.types as types
from ai_trpg.mcp import mcp_config
from fastapi import Request, Response, status
from ai_trpg.demo import create_test_world1
from typing import Any, Dict, NamedTuple


# 辅助函数！！！

test_world = create_test_world1()


class StageStateComponents(NamedTuple):
    """场景状态组件"""

    narrative: str
    actor_states: str
    environment: str


def _parse_and_format_stage_state(state_data: str) -> StageStateComponents:
    """
    解析场景状态JSON并格式化角色状态为Markdown

    将JSON格式的场景状态解析为三个独立的文本组件，
    其中角色状态会被格式化为Markdown列表格式。

    Args:
        state_data: 场景状态的JSON字符串，包含以下字段：
            - narrative: 场景叙事文本
            - actor_states: 角色状态列表
            - environment_state: 环境描述文本

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
    environment_text = state_dict.get("environment_state", "")
    narrative_text = state_dict.get("narrative", "")

    return StageStateComponents(
        narrative=narrative_text, actor_states=actors_text, environment=environment_text
    )


def _get_actor_info_impl(actor_name: str) -> str:
    """
    获取Actor信息的内部实现（辅助函数）

    Args:
        actor_name: 角色名称

    Returns:
        Actor的JSON数据，包含名称、外观描述和角色属性（生命值、攻击力等）
    """
    try:
        actor, stage = test_world.find_actor_with_stage(actor_name)
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


def _get_stage_info_impl(stage_name: str) -> str:
    """
    获取Stage信息的内部实现（辅助函数）

    Args:
        stage_name: 场景名称

    Returns:
        Stage的JSON数据，包含场景的所有属性（名称、叙事、环境、角色外观等）
    """
    try:
        stage = test_world.find_stage(stage_name)
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


# ============================================================================
# 创建 FastMCP 应用实例
# ============================================================================

app = FastMCP(
    name=mcp_config.server_name,
    instructions=mcp_config.server_description,
    debug=True,
)

# ============================================================================
# 注册健康检查端点
# ============================================================================


@app.custom_route("/health", methods=["POST"])  # type: ignore[misc]
async def health_check(request: Request) -> Response:
    """处理 MCP 健康检查请求"""
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        if data.get("method") == "ping":
            response_data = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "result": {"status": "ok"},
            }
            return Response(
                content=json.dumps(response_data),
                media_type="application/json",
                status_code=status.HTTP_200_OK,
            )
        else:
            error_response = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "error": {"code": -32601, "message": "Method not found"},
            }
            return Response(
                content=json.dumps(error_response),
                media_type="application/json",
                status_code=status.HTTP_200_OK,
            )
    except Exception as e:
        error_response = {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32700, "message": f"Parse error: {str(e)}"},
        }
        return Response(
            content=json.dumps(error_response),
            media_type="application/json",
            status_code=status.HTTP_400_BAD_REQUEST,
        )


# ============================================================================
# 注册工具
# ============================================================================


@app.tool()
async def get_world_info() -> str:
    """
    获取游戏世界（World）的完整信息

    Returns:
        World的完整JSON数据，包含所有场景和角色的嵌套信息
    """
    try:
        logger.info(f"获取World数据: {test_world.name}")
        return test_world.model_dump_json(indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"获取World信息失败: {e}")
        return json.dumps(
            {
                "error": f"无法获取World数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.tool()
async def get_stage_info(stage_name: str) -> str:
    """
    根据场景名称获取Stage的完整信息（角色信息为精简版）

    Args:
        stage_name: 场景名称

    Returns:
        Stage的完整JSON数据，包含场景的所有属性（名称、叙事、环境、子场景等）
        以及场景中角色的简要信息（仅包含角色名称和外观描述，不包含档案和已知角色列表）
    """
    return _get_stage_info_impl(stage_name)


@app.tool()
async def get_actor_info(actor_name: str) -> str:
    """
    根据角色名称获取Actor的信息

    Args:
        actor_name: 角色名称

    Returns:
        Actor的JSON数据，包含名称、外观描述和角色属性（生命值、攻击力等）
    """
    return _get_actor_info_impl(actor_name)


@app.tool()
async def sync_stage_state(
    stage_name: str,
    state_data: str,
) -> str:
    """
    同步场景状态数据到MCP Server

    接收场景状态的JSON数据并记录。

    Args:
        stage_name: 场景名称
        state_data: 场景状态的JSON字符串

    Returns:
        同步操作的结果（JSON格式）
    """
    try:
        # 验证Stage存在
        stage = test_world.find_stage(stage_name)
        if not stage:
            error_msg = f"错误：未找到名为 '{stage_name}' 的Stage"
            logger.warning(error_msg)
            return json.dumps(
                {"success": False, "error": error_msg},
                ensure_ascii=False,
            )

        # 解析并格式化状态数据
        components = _parse_and_format_stage_state(state_data)

        # 打印格式化后的组件
        logger.warning(f"narrative:\n{components.narrative}")
        logger.warning(f"actor_states:\n{components.actor_states}")
        logger.warning(f"environment:\n{components.environment}")

        # 更新Stage状态
        stage.narrative = components.narrative
        stage.actor_states = components.actor_states
        stage.environment = components.environment

        return json.dumps(
            {
                "success": True,
                "stage_name": stage_name,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
        )

    except Exception as e:
        logger.error(f"同步失败: {e}")
        return json.dumps(
            {"success": False, "error": str(e)},
            ensure_ascii=False,
        )


# @app.tool()
async def move_actor(actor_name: str, target_stage_name: str) -> str:
    """
    将指定的Actor从当前Stage移动到目标Stage

    Args:
        actor_name: 要移动的Actor名称
        target_stage_name: 目标Stage名称

    Returns:
        移动操作的结果信息（JSON格式）
    """
    try:
        # 查找Actor当前所在的Stage
        actor, current_stage = test_world.find_actor_with_stage(actor_name)
        if not current_stage or not actor:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor"
            logger.warning(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        # 查找目标Stage
        target_stage = test_world.find_stage(target_stage_name)
        if not target_stage:
            error_msg = f"错误：未找到名为 '{target_stage_name}' 的目标Stage"
            logger.warning(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        # 检查是否已经在目标Stage
        if current_stage.name == target_stage.name:
            info_msg = f"{actor_name} 已经在 {target_stage_name} 中"
            logger.info(info_msg)
            return json.dumps(
                {
                    "success": True,
                    "message": info_msg,
                    "actor": actor_name,
                    "current_stage": current_stage.name,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        # 从当前Stage移除Actor
        current_stage.actors.remove(actor)

        # 添加Actor到目标Stage
        target_stage.actors.append(actor)

        success_msg = (
            f"{actor_name} 成功从 {current_stage.name} 移动到 {target_stage_name}"
        )
        logger.info(success_msg)

        return json.dumps(
            {
                "success": True,
                "message": success_msg,
                "actor": actor_name,
                "from_stage": current_stage.name,
                "to_stage": target_stage.name,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"移动Actor失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"移动Actor失败 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


# ============================================================================
# 注册资源
# ============================================================================


@app.resource("game://config")
async def get_game_config() -> str:
    """获取游戏配置（静态资源）"""
    try:
        config = {
            "game_version": "1.0.0",
            "game_mode": "adventure",
            "max_players": 4,
            "difficulty": "normal",
            "server_config": {
                "host": mcp_config.mcp_server_host,
                "port": mcp_config.mcp_server_port,
            },
        }
        logger.info("读取游戏配置资源")
        return json.dumps(config, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"获取游戏配置失败: {e}")
        return f"错误：{str(e)}"


@app.resource("game://entity/{entity_name}")
async def get_entity_resource(entity_name: str) -> str:
    """
    获取游戏世界实体资源（根据名称获取World、Stage或Actor的完整数据）

    Args:
        entity_name: 实体名称（可以是World名称、Stage名称或Actor名称）

    Returns:
        对应实体的完整JSON数据，包含所有嵌套信息
    """
    # URL 解码实体名称（处理中文等特殊字符）
    decoded_entity_name = unquote(entity_name)
    logger.debug(f"原始 entity_name: {entity_name}, 解码后: {decoded_entity_name}")

    try:
        # 检查是否是World
        if decoded_entity_name == test_world.name:
            logger.info(f"获取World数据: {decoded_entity_name}")
            return test_world.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Stage
        stage = test_world.find_stage(decoded_entity_name)
        if stage:
            logger.info(f"获取Stage数据: {decoded_entity_name}")
            return stage.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Actor
        actor, stage = test_world.find_actor_with_stage(decoded_entity_name)
        if actor and stage:
            logger.info(
                f"获取Actor数据: {decoded_entity_name}, 所在Stage: {stage.name}"
            )
            # 将Actor和其所在的Stage信息打包
            result = {
                "actor": actor.model_dump(),
                "stage": {
                    "name": stage.name,
                    "profile": stage.profile,
                    "environment": stage.environment,
                },
            }
            return json.dumps(result, ensure_ascii=False, indent=2)

        # 未找到任何匹配
        error_msg = f"错误：未找到名为 '{decoded_entity_name}' 的World、Stage或Actor"
        logger.warning(error_msg)
        return json.dumps(
            {"error": error_msg, "timestamp": datetime.now().isoformat()},
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"获取游戏世界实体失败: {e}")
        return json.dumps(
            {
                "error": f"无法获取游戏世界实体数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.resource("game://actor/{actor_name}")
async def get_actor_resource(actor_name: str) -> str:
    """
    获取Actor信息资源（根据角色名称获取Actor的信息）

    Args:
        actor_name: 角色名称

    Returns:
        Actor的JSON数据，包含名称、外观描述和角色属性（生命值、攻击力等）
    """
    # URL 解码角色名称（处理中文等特殊字符）
    decoded_actor_name = unquote(actor_name)
    logger.debug(f"原始 actor_name: {actor_name}, 解码后: {decoded_actor_name}")

    return _get_actor_info_impl(decoded_actor_name)


@app.resource("game://stage/{stage_name}")
async def get_stage_resource(stage_name: str) -> str:
    """
    获取Stage信息资源（根据场景名称获取Stage的信息）

    Args:
        stage_name: 场景名称

    Returns:
        Stage的JSON数据，包含场景的所有属性（名称、叙事、环境等）
    """
    # URL 解码场景名称（处理中文等特殊字符）
    decoded_stage_name = unquote(stage_name)
    logger.debug(f"原始 stage_name: {stage_name}, 解码后: {decoded_stage_name}")

    return _get_stage_info_impl(decoded_stage_name)


@app.resource("game://world")
async def get_world_resource() -> str:
    """
    获取游戏世界（World）信息资源

    Returns:
        World的完整JSON数据，包含所有场景和角色的嵌套信息
    """

    # 创建游戏世界
    global test_world
    test_world = create_test_world1()

    try:

        logger.info(f"获取World数据: {test_world.name}")
        return test_world.model_dump_json(indent=2, ensure_ascii=False)

    except Exception as e:
        logger.error(f"获取World信息失败: {e}")
        return json.dumps(
            {
                "error": f"无法获取World数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


# ============================================================================
# 注册提示词模板
# ============================================================================
# game_system_prompt_example --player_name=张三 --current_stage=客厅 --world_name=测试世界
@app.prompt()
async def game_system_prompt_example() -> types.GetPromptResult:
    """
    提供游戏系统提示词模板（示例）

    这是一个示例提示词模板，展示如何使用参数化的提示词。
    实际使用时，客户端可以传入具体的参数值来替换模板中的占位符。
    """

    prompt_example = """# 游戏系统提示词模板（示例）

> **注意**：这是一个示例模板，用于演示 MCP Prompt 功能的使用方式。
> 实际使用时，请根据具体场景自定义模板内容和参数。

## 角色设定
- **玩家名称**: {player_name}
- **当前场景**: {current_stage}
- **游戏世界**: {world_name}"""

    return types.GetPromptResult(
        description="游戏系统提示词模板（示例） - 展示如何使用多参数提示词模板",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=prompt_example),
            )
        ],
    )


# ============================================================================
# 主函数
# ============================================================================


def main() -> None:
    """启动 Game MCP 服务器"""

    logger.info(f"🎮 启动 {mcp_config.server_name} v{mcp_config.server_version}")
    logger.info(f"📡 传输协议: {mcp_config.transport} ({mcp_config.protocol_version})")
    logger.info(
        f"🌐 服务地址: http://{mcp_config.mcp_server_host}:{mcp_config.mcp_server_port}"
    )

    # 配置并启动服务器
    app.settings.host = mcp_config.mcp_server_host
    app.settings.port = mcp_config.mcp_server_port

    try:
        logger.info("✅ 服务器启动完成，等待客户端连接...")
        app.run(transport="streamable-http")
    except KeyboardInterrupt:
        logger.info("🛑 收到中断信号，正在关闭服务器...")
    except Exception as e:
        logger.error(f"❌ 服务器启动失败: {e}")
        raise
    finally:
        logger.info("👋 服务器已关闭")


if __name__ == "__main__":
    main()

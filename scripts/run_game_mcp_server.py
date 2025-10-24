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
from magic_book.mcp import mcp_config
from fastapi import Request, Response
from magic_book.demo.test_world import test_world

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
                status_code=200,
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
                status_code=200,
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
            status_code=400,
        )


# ============================================================================
# 注册工具
# ============================================================================


@app.tool()
async def find_entity_by_name(name: str) -> str:
    """
    根据名称获取游戏世界实体（World、Stage或Actor）的完整数据

    Args:
        name: 实体名称（可以是World名称、Stage名称或Actor名称）

    Returns:
        对应实体的完整JSON数据，包含所有嵌套信息
    """
    try:
        # 检查是否是World
        if name == test_world.name:
            logger.info(f"获取World数据: {name}")
            return test_world.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Stage
        stage = test_world.find_stage(name)
        if stage:
            logger.info(f"获取Stage数据: {name}")
            return stage.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Actor
        actor, stage = test_world.find_actor_with_stage(name)
        if actor and stage:
            logger.info(f"获取Actor数据: {name}, 所在Stage: {stage.name}")
            # 将Actor和其所在的Stage信息打包
            result = {
                "actor": actor.model_dump(),
                "stage": {
                    "name": stage.name,
                    "description": stage.description,
                    "environment": stage.environment,
                },
            }
            return json.dumps(result, ensure_ascii=False, indent=2)

        # 未找到任何匹配
        error_msg = f"错误：未找到名为 '{name}' 的World、Stage或Actor"
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


@app.tool()
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


#############################################################################################################
#############################################################################################################
#############################################################################################################
@app.resource("game://dynamic/{resource_id}")
async def get_dynamic_resource(resource_id: str) -> str:
    """
    获取动态游戏资源（根据名称获取游戏世界实体的完整数据）

    Args:
        resource_id: 资源标识符（可以是World名称、Stage名称或Actor名称）

    Returns:
        对应实体的完整JSON数据，包含所有嵌套信息
    """
    try:
        # URL 解码资源ID（处理中文等特殊字符）
        decoded_resource_id = unquote(resource_id)
        logger.debug(f"原始 resource_id: {resource_id}, 解码后: {decoded_resource_id}")

        # 检查是否是World
        if decoded_resource_id == test_world.name:
            logger.info(f"获取World数据: {decoded_resource_id}")
            return test_world.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Stage
        stage = test_world.find_stage(decoded_resource_id)
        if stage:
            logger.info(f"获取Stage数据: {decoded_resource_id}")
            return stage.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Actor
        actor, _ = test_world.find_actor_with_stage(decoded_resource_id)
        if actor:
            logger.info(f"获取Actor数据: {decoded_resource_id}")
            return actor.model_dump_json(indent=2, ensure_ascii=False)

        # 未找到任何匹配
        error_msg = f"错误：未找到名为 '{decoded_resource_id}' 的World、Stage或Actor"
        logger.warning(error_msg)
        return json.dumps(
            {"error": error_msg, "timestamp": datetime.now().isoformat()},
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"获取动态资源失败: {e}")
        return json.dumps(
            {
                "error": f"无法获取动态资源数据 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


# ============================================================================
# 注册提示词模板
# ============================================================================


@app.prompt()
async def game_prompt_sample() -> types.GetPromptResult:
    """
    提供游戏系统提示词模板
    """

    prompt_template = """# 这是一个测试的提示词模板
## 说明
1. 发送对象：玩家 -> 游戏系统（游戏管理员）
2. 游戏系统（游戏管理员）拥有最高权限，负责管理和维护游戏世界的秩序与运行。
3. 游戏系统（游戏管理员）需要根据玩家的指令内容，采取相应的行动，如更新游戏状态、提供信息等。
# 指令内容
{command_content}"""

    return types.GetPromptResult(
        description=f"游戏系统提示模板",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=prompt_template),
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

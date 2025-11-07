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
from ai_trpg.demo import clone_test_world1, Effect

# 导入辅助函数模块
from mcp_server_helpers import (
    # parse_and_format_stage_state,
    get_actor_info_impl,
    get_stage_info_impl,
)

# 初始化游戏世界
test_world = clone_test_world1()


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


# @app.tool()
async def get_world_info(world_name: str) -> str:
    """
    获取游戏世界（World）的完整信息

    Returns:
        World的完整JSON数据，包含所有场景和角色的嵌套信息
    """
    try:

        if world_name != test_world.name:
            logger.error(
                f"World名称不匹配: 请求的 {world_name}, 现有的 {test_world.name}???!"
            )

        logger.info(f"获取World数据: {world_name}")
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


# @app.tool()
async def get_stage_info(stage_name: str) -> str:
    """
    根据场景名称获取Stage的完整信息（角色信息为精简版）

    Args:
        stage_name: 场景名称

    Returns:
        Stage的完整JSON数据，包含场景的所有属性（名称、叙事、环境、子场景等）
        以及场景中角色的简要信息（仅包含角色名称和外观描述，不包含档案和已知角色列表）
    """
    return get_stage_info_impl(test_world, stage_name)


# @app.tool()
async def get_actor_info(actor_name: str) -> str:
    """
    根据角色名称获取Actor的信息

    Args:
        actor_name: 角色名称

    Returns:
        Actor的JSON数据，包含名称、外观描述和角色属性（生命值、攻击力等）
    """
    return get_actor_info_impl(test_world, actor_name)


@app.tool()
async def sync_stage_state(
    stage_name: str,
    narrative: str,
    actor_states: str,
    environment: str,
    calculation_log: str,
) -> str:
    """
    更新场景的动态状态信息

    将场景的叙事、角色状态和环境描述更新为最新内容。
    用于在场景执行后保存场景的当前状态。

    Args:
        stage_name: 场景名称
        narrative: 场景叙事描述
        actor_states: 角色状态字符串（格式：**角色名**: 位置 | 姿态 | 状态）
        environment: 环境描述
        calculation_log: 战斗计算或互动过程的日志记录

    Returns:
        更新操作的结果（JSON格式）
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

        # 打印接收到的数据
        logger.warning(f"calculation_log:\n{calculation_log}")
        logger.warning(f"narrative:\n{narrative}")
        logger.warning(f"actor_states:\n{actor_states}")
        logger.warning(f"environment:\n{environment}")

        # 直接更新Stage状态（不需要额外解析）
        stage.narrative = narrative
        stage.actor_states = actor_states
        stage.environment = environment

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


@app.tool()
async def update_actor_appearance(actor_name: str, new_appearance: str) -> str:
    """
    更新指定Actor的外观描述

    Args:
        actor_name: 要更新的Actor名称
        new_appearance: 新的外观描述文本

    Returns:
        更新操作的结果信息（JSON格式）
    """
    try:
        # 查找Actor
        actor, current_stage = test_world.find_actor_with_stage(actor_name)
        if not actor or not current_stage:
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

        # 保存旧的外观描述以便日志记录
        old_appearance = actor.appearance

        # 更新Actor的appearance字段
        actor.appearance = new_appearance

        success_msg = f"成功更新 {actor_name} 的外观描述"
        logger.warning(
            f"{success_msg}\n旧外观: {old_appearance}\n\n新外观: {new_appearance}"
        )

        return json.dumps(
            {
                "success": True,
                "actor": actor_name,
                "new_appearance": new_appearance,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"更新Actor外观失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"更新Actor外观失败 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.tool()
async def add_actor_effect(
    actor_name: str, effect_name: str, effect_description: str
) -> str:
    """
    为指定Actor添加一个新的效果/状态

    Args:
        actor_name: 要添加效果的Actor名称
        effect_name: 效果名称
        effect_description: 效果描述

    Returns:
        添加操作的结果信息（JSON格式）
    """
    try:
        # 查找Actor
        actor, current_stage = test_world.find_actor_with_stage(actor_name)
        if not actor or not current_stage:
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

        # 创建新的 Effect
        new_effect = Effect(name=effect_name, description=effect_description)

        # 添加效果到Actor
        actor.effects.append(new_effect)

        success_msg = f"成功为 {actor_name} 添加效果: {effect_name}"
        logger.warning(f"{success_msg}\n效果描述: {effect_description}")

        return json.dumps(
            {
                "success": True,
                "actor": actor_name,
                "effect": new_effect.model_dump(),
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"添加Actor效果失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"添加Actor效果失败 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.tool()
async def remove_actor_effect(actor_name: str, effect_name: str) -> str:
    """
    移除指定Actor身上所有匹配指定名称的效果/状态

    Args:
        actor_name: 要移除效果的Actor名称
        effect_name: 要移除的效果名称（所有匹配此名称的效果都会被移除）

    Returns:
        移除操作的结果信息（JSON格式），包含移除的效果数量
    """
    try:
        # 查找Actor
        actor, current_stage = test_world.find_actor_with_stage(actor_name)
        if not actor or not current_stage:
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

        # 找出所有匹配名称的效果
        effects_to_remove = [
            effect for effect in actor.effects if effect.name == effect_name
        ]

        # 如果没有找到匹配的效果
        if not effects_to_remove:
            info_msg = f"{actor_name} 身上没有名为 '{effect_name}' 的效果"
            logger.warning(info_msg)
            return json.dumps(
                {
                    "success": True,
                    "message": info_msg,
                    "actor": actor_name,
                    "removed_count": 0,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        # 移除所有匹配的效果
        removed_count = 0
        for effect in effects_to_remove:
            actor.effects.remove(effect)
            removed_count += 1

        success_msg = (
            f"成功从 {actor_name} 移除了 {removed_count} 个名为 '{effect_name}' 的效果"
        )
        logger.warning(success_msg)

        return json.dumps(
            {
                "success": True,
                "message": success_msg,
                "actor": actor_name,
                "effect_name": effect_name,
                "removed_count": removed_count,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"移除Actor效果失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"移除Actor效果失败 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.tool()
async def update_actor_health(actor_name: str, new_health: int) -> str:
    """
    更新指定Actor的生命值（health）

    Args:
        actor_name: 要更新生命值的Actor名称
        new_health: 新的生命值（会被限制在 0 到 max_health 之间）

    Returns:
        更新操作的结果信息（JSON格式），包含旧生命值和新生命值
    """
    try:
        # 查找Actor
        actor, current_stage = test_world.find_actor_with_stage(actor_name)
        if not actor or not current_stage:
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

        # 保存旧的生命值
        old_health = actor.attributes.health
        max_health = actor.attributes.max_health

        # 限制生命值在 0 到 max_health 之间
        clamped_health = max(0, min(new_health, max_health))

        # 更新Actor的health值
        actor.attributes.health = clamped_health

        # 记录日志
        logger.warning(
            f"更新 {actor_name} 生命值: {old_health} → {clamped_health}/{max_health}"
        )

        return json.dumps(
            {
                "success": True,
                "actor": actor_name,
                "old_health": old_health,
                "new_health": clamped_health,
                "max_health": max_health,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"更新Actor生命值失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"更新Actor生命值失败 - {str(e)}",
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
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
            logger.warning(info_msg)
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
        logger.warning(success_msg)

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

    return get_actor_info_impl(test_world, decoded_actor_name)


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

    return get_stage_info_impl(test_world, decoded_stage_name)


@app.resource("game://world")
async def get_world_resource() -> str:
    """
    获取游戏世界（World）信息资源

    Returns:
        World的完整JSON数据，包含所有场景和角色的嵌套信息
    """

    # 创建游戏世界
    global test_world
    test_world = clone_test_world1()

    try:

        # logger.info(f"获取World数据: {test_world.name}")
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


@app.prompt()
async def game_system_prompt_example() -> types.GetPromptResult:
    """
    提供游戏系统提示词模板（示例）

    这是一个示例提示词模板，展示如何使用参数化的提示词。
    实际使用时，客户端可以传入具体的参数值来替换模板中的占位符。
    测试用例: game_system_prompt_example --player_name=张三 --current_stage=客厅 --world_name=测试世界
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

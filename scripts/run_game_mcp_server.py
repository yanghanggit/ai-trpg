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
from ai_trpg.demo import create_demo_world, World
from ai_trpg.pgsql import (
    get_world_id_by_name,
    save_actor_movement_event_to_db,
    update_stage_info,
    move_actor_to_stage_db,
)

# 导入辅助函数模块
from mcp_server_helpers import (
    get_actor_info_impl,
    get_stage_info_impl,
)

from ai_trpg.pgsql.actor_operations import (
    update_actor_health as update_actor_health_db,
    update_actor_appearance as update_actor_appearance_db,
    add_actor_effect as add_actor_effect_db,
    remove_actor_effect as remove_actor_effect_db,
)


# 初始化游戏世界
demo_world: World = create_demo_world()


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
async def update_stage_execution_result(
    world_name: str,
    stage_name: str,
    calculation_log: str,
    narrative: str,
    actor_states: str,
    environment: str,
    connections: str,
) -> str:
    """
    保存场景执行结果

    将场景执行后的计算日志、叙事描述、角色状态、环境变化和场景连通性保存到游戏世界。
    这个工具用于持久化场景执行的完整结果。

    Args:
        world_name: 游戏世界名称
        stage_name: 场景名称
        calculation_log: 战斗计算或互动过程的日志记录
        narrative: 场景叙事描述
        actor_states: 角色状态字符串（格式：**角色名**: 位置 | 姿态 | 状态）
        environment: 环境描述
        connections: 场景连通性描述。可以保持原值不变，或根据场景事件更新（如门被打开/锁上、通道被发现/封闭等）

    Returns:
        更新操作的结果（JSON格式）
    """
    try:

        # assert world_name == demo_world.name, f"未知的世界名称: {world_name}"

        # # 验证Stage存在
        # stage = demo_world.find_stage(stage_name)
        # if not stage:
        #     error_msg = f"错误：未找到名为 '{stage_name}' 的Stage"
        #     logger.error(error_msg)
        #     return json.dumps(
        #         {"success": False, "error": error_msg},
        #         ensure_ascii=False,
        #     )

        # 打印接收到的数据
        logger.warning(f"calculation_log:\n{calculation_log}")
        logger.info(f"narrative:\n{narrative}")
        logger.info(f"actor_states:\n{actor_states}")
        logger.info(f"environment:\n{environment}")
        logger.info(f"connections:\n{connections}")

        # 直接更新Stage状态（不需要额外解析）
        # stage.narrative = narrative
        # stage.actor_states = actor_states
        # stage.environment = environment
        # stage.connections = connections

        # 请在这个位置使用 update_stage_info 函数将更新同步到数据库
        world_id = get_world_id_by_name(world_name=world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"
        update_stage_info(
            world_id=world_id,
            stage_name=stage_name,
            environment=environment,
            narrative=narrative,
            actor_states=actor_states,
            connections=connections,
        )

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
async def move_actor_to_stage(
    world_name: str,
    actor_name: str,
    target_stage_name: str,
    entry_posture_and_status: str,
) -> str:
    """
    将角色从当前场景移动到目标场景

    Args:
        world_name: 游戏世界名称
        actor_name: 要移动的角色名称
        target_stage_name: 目标场景名称
        entry_posture_and_status: 进入姿态与状态（格式：姿态 | 状态）

    Returns:
        操作结果的JSON字符串
    """
    try:
        # 步骤1: 获取 world_id
        world_id = get_world_id_by_name(world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"

        # 步骤2: 执行数据库层面的移动操作（同时返回源场景名称）
        move_success, source_stage_name = move_actor_to_stage_db(
            world_id=world_id,
            actor_name=actor_name,
            target_stage_name=target_stage_name,
        )

        # 如果移动失败
        if not move_success:
            error_msg = (
                f"移动失败：角色 '{actor_name}' 或目标场景 '{target_stage_name}' 不存在"
            )
            logger.error(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "actor": actor_name,
                    "target_stage": target_stage_name,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        # 步骤3: 移动成功，记录移动事件到数据库
        success_msg = f"成功将角色 '{actor_name}' 从场景 '{source_stage_name}' 移动到 '{target_stage_name}', 进入姿态与状态: {entry_posture_and_status}）"
        logger.info(success_msg)

        # 步骤4: 存储一个临时事件，用于后续的通知！
        save_actor_movement_event_to_db(
            world_id=world_id,
            actor_name=actor_name,
            from_stage=source_stage_name,
            to_stage=target_stage_name,
            description=success_msg,
            entry_posture_and_status=entry_posture_and_status,
        )

        return json.dumps(
            {
                "success": True,
                "message": success_msg,
                "actor": actor_name,
                "source_stage": source_stage_name,
                "target_stage": target_stage_name,
                "entry_posture_and_status": entry_posture_and_status,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"移动角色失败: {e}")
        return json.dumps(
            {
                "success": False,
                "error": f"移动角色失败 - {str(e)}",
                "actor": actor_name,
                "target_stage": target_stage_name,
                "timestamp": datetime.now().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


@app.tool()
async def update_actor_appearance(
    world_name: str, actor_name: str, new_appearance: str
) -> str:
    """
    更新指定Actor的外观描述

    Args:
        world_name: 游戏世界名称
        actor_name: 要更新的Actor名称
        new_appearance: 新的外观描述文本

    Returns:
        更新操作的结果信息（JSON格式）
    """
    try:
        # 步骤1: 获取 world_id
        world_id = get_world_id_by_name(world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"

        # 步骤2: 执行数据库更新（返回旧的外观描述）

        old_appearance = update_actor_appearance_db(
            world_id, actor_name, new_appearance
        )
        if old_appearance is None:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor或更新失败"
            logger.error(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        success_msg = f"成功更新 {actor_name} 的外观描述"
        logger.info(success_msg)

        return json.dumps(
            {
                "success": True,
                "actor": actor_name,
                "old_appearance": old_appearance,
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
    world_name: str, actor_name: str, effect_name: str, effect_description: str
) -> str:
    """
    为指定Actor添加一个新的 Effect

    Args:
        world_name: 游戏世界名称
        actor_name: 要添加 Effect 的Actor名称
        effect_name: Effect 名称
        effect_description: Effect 描述

    Returns:
        添加操作的结果信息（JSON格式）
    """
    try:
        # 步骤1: 获取 world_id
        world_id = get_world_id_by_name(world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"

        # 步骤2: 执行数据库添加操作

        success = add_actor_effect_db(
            world_id, actor_name, effect_name, effect_description
        )
        if not success:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor或添加失败"
            logger.error(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        success_msg = f"成功为 {actor_name} 添加效果: {effect_name}"
        logger.info(success_msg)

        return json.dumps(
            {
                "success": True,
                "actor": actor_name,
                "effect": {
                    "name": effect_name,
                    "description": effect_description,
                },
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
async def remove_actor_effect(
    world_name: str, actor_name: str, effect_name: str
) -> str:
    """
    移除指定Actor身上所有匹配指定名称的 Effect

    Args:
        world_name: 游戏世界名称
        actor_name: 要移除 Effect 的Actor名称
        effect_name: 要移除的 Effect 名称（所有匹配此名称的 Effect 都会被移除）

    Returns:
        移除操作的结果信息（JSON格式），包含移除的 Effect 数量
    """
    try:

        # 步骤1: 获取 world_id
        world_id = get_world_id_by_name(world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"

        # 步骤2: 执行数据库删除操作
        removed_count = remove_actor_effect_db(world_id, actor_name, effect_name)
        if removed_count == -1:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor"
            logger.error(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        if removed_count == 0:
            info_msg = f"{actor_name} 身上没有名为 '{effect_name}' 的效果"
            logger.info(info_msg)
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

        success_msg = (
            f"成功从 {actor_name} 移除了 {removed_count} 个名为 '{effect_name}' 的效果"
        )
        logger.info(success_msg)

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
async def update_actor_health(world_name: str, actor_name: str, new_health: int) -> str:
    """
    更新指定Actor的生命值（health）

    Args:
        world_name: 游戏世界名称
        actor_name: 要更新生命值的Actor名称
        new_health: 新的生命值（会被限制在 0 到 max_health 之间）

    Returns:
        更新操作的结果信息（JSON格式），包含旧生命值和新生命值
    """
    try:
        # 步骤1: 获取 world_id
        world_id = get_world_id_by_name(world_name)
        assert world_id is not None, f"世界 '{world_name}' 未在数据库中找到"

        result = update_actor_health_db(world_id, actor_name, new_health)
        if not result:
            error_msg = f"错误：未找到名为 '{actor_name}' 的Actor或更新失败"
            logger.error(error_msg)
            return json.dumps(
                {
                    "success": False,
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )

        old_health, clamped_health, max_health = result

        logger.info(
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

    return get_actor_info_impl(demo_world, decoded_actor_name)


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

    return get_stage_info_impl(demo_world, decoded_stage_name)


# @app.resource("game://world")
# async def get_world_resource() -> str:
#     """
#     获取游戏世界(World)信息资源

#     Returns:
#         统一格式的JSON响应:
#         {
#             "data": World的完整数据或null,
#             "error": 错误信息或null,
#             "timestamp": ISO格式时间戳
#         }
#     """

#     return get_world_info_impl(demo_world)


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

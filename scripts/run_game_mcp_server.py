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
from typing import Dict, List
from loguru import logger
from mcp.server.fastmcp import FastMCP
import mcp.types as types
from magic_book.mcp import mcp_config
from pydantic import BaseModel

# from magic_book.game.config import setup_logger
from fastapi import Request, Response

# ============================================================================
# 初始化日志系统
# ============================================================================

# setup_logger()

# ============================================================================
# 游戏数据字典
# ============================================================================

GAME_DATA: Dict[str, str] = {
    "player_hp": "100",
    "player_level": "5",
    "game_status": "running",
    "player_name": "Hero",
    "current_scene": "forest",
    "inventory_size": "10",
}


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str
    description: str
    appearance: str


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str
    description: str
    environment: str
    actors: List[Actor]
    stages: List["Stage"] = []  # 支持嵌套子场景


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str
    description: str
    stages: List[Stage]


# ============================================================================
# 游戏世界实例
# ============================================================================

game_world = World(
    name="艾泽拉斯大陆",
    description="一个充满魔法与冒险的奇幻世界，古老的传说在这里流传，英雄们在这片土地上书写着自己的史诗。",
    stages=[
        # 翡翠森林（主场景区域，包含子场景）
        Stage(
            name="翡翠森林",
            description="艾泽拉斯大陆上最古老的森林之一，充满了生命的魔法能量。这片广袤的森林由多个区域组成，每个区域都有其独特的景观和居民。",
            environment="古老而神秘的森林，参天巨树遮天蔽日，空气中弥漫着自然魔法的气息。森林深处隐藏着许多秘密和传说。",
            actors=[],
            stages=[
                # 子场景1：月光林地（空场景）
                Stage(
                    name="月光林地",
                    description="翡翠森林的北部区域，这片林地在夜晚会被月光笼罩，显得格外宁静祥和。古老的石碑矗立在林地中央，通往南边的星语圣树。",
                    environment="银色的月光透过树叶间隙洒落，照亮了布满青苔的石板路。四周是参天的古树，偶尔能听到夜莺的歌声。一条蜿蜒的小路向南延伸，连接着森林深处。",
                    actors=[],
                ),
                # 子场景2：星语圣树（有角色的场景）
                Stage(
                    name="星语圣树",
                    description="翡翠森林的核心区域，一棵巨大的生命古树屹立于此，这是德鲁伊们的圣地。从北边的月光林地可以直接到达这里。",
                    environment="一棵高耸入云的巨大古树占据了视野中心，树干粗壮到需要数十人才能环抱。树根盘绕形成天然的平台，树冠上挂满发光的藤蔓和花朵。空气中充满了浓郁的生命能量。",
                    actors=[
                        Actor(
                            name="艾尔温·星语",
                            description="精灵族的德鲁伊长老，守护翡翠森林已有千年之久。他精通自然魔法，能与森林中的生物沟通。常驻于星语圣树，但也会前往月光林地巡视。",
                            appearance="身穿绿色长袍的高大精灵，银白色的长发及腰，碧绿的眼眸中闪烁着智慧的光芒，手持一根雕刻着古老符文的木杖",
                        ),
                        Actor(
                            name="索尔娜·影舞",
                            description="神秘的暗夜精灵游侠，是森林的守护者。她在两个区域间穿梭巡逻，行踪飘忽，箭术精湛，总是在危险来临前出现。",
                            appearance="身着深紫色皮甲的矫健身影,紫色的肌肤在月光下闪耀,银色的长发束成高马尾,背后背着一把精致的月牙弓和装满银色羽箭的箭筒",
                        ),
                    ],
                ),
            ],
        ),
    ],
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
async def get_game_data(key: str) -> str:
    """
    从游戏数据字典获取指定键的值

    Args:
        key: 数据键名 (player_hp|player_level|game_status|player_name|current_scene|inventory_size)

    Returns:
        对应的游戏数据值，如果键不存在则返回错误信息
    """
    try:
        if key in GAME_DATA:
            result = {
                "key": key,
                "value": GAME_DATA[key],
                "timestamp": datetime.now().isoformat(),
            }
            logger.info(f"获取游戏数据: {key} = {GAME_DATA[key]}")
            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            available_keys = ", ".join(GAME_DATA.keys())
            error_msg = f"错误：键 '{key}' 不存在。可用的键：{available_keys}"
            logger.warning(error_msg)
            return error_msg

    except Exception as e:
        logger.error(f"获取游戏数据失败: {e}")
        return f"错误：无法获取游戏数据 - {str(e)}"


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


@app.resource("game://dynamic/player")
async def get_player_resource_example() -> str:
    """获取玩家信息（动态资源示例 - 固定 resource_id=player）"""
    value = await get_dynamic_resource("player")
    return str(value)


@app.resource("game://dynamic/{resource_id}")
async def get_dynamic_resource(resource_id: str) -> str:
    """
    获取动态游戏资源

    Args:
        resource_id: 资源标识符

    Returns:
        动态生成的资源内容
    """
    try:
        # 模拟不同类型的动态资源
        resource_types = {
            "player": {
                "type": "player_info",
                "data": {
                    "name": GAME_DATA.get("player_name", "Unknown"),
                    "hp": GAME_DATA.get("player_hp", "0"),
                    "level": GAME_DATA.get("player_level", "1"),
                },
            },
            "scene": {
                "type": "scene_info",
                "data": {
                    "current": GAME_DATA.get("current_scene", "unknown"),
                    "description": "一片神秘的森林",
                },
            },
            "inventory": {
                "type": "inventory_info",
                "data": {
                    "size": GAME_DATA.get("inventory_size", "0"),
                    "items": ["sword", "shield", "potion"],
                },
            },
        }

        if resource_id in resource_types:
            result = {
                "resource_id": resource_id,
                "content": resource_types[resource_id],
                "timestamp": datetime.now().isoformat(),
            }
            logger.info(f"读取动态资源: {resource_id}")
            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            available_ids = ", ".join(resource_types.keys())
            error_msg = (
                f"错误：资源 '{resource_id}' 不存在。可用的资源：{available_ids}"
            )
            logger.warning(error_msg)
            return error_msg

    except Exception as e:
        logger.error(f"获取动态资源失败: {e}")
        return f"错误：{str(e)}"


# ============================================================================
# 注册提示词模板
# ============================================================================


@app.prompt()
async def game_prompt(scenario: str = "default") -> types.GetPromptResult:
    """
    游戏场景提示词模板

    Args:
        scenario: 场景类型 (default|battle|exploration|dialogue)
    """
    prompts = {
        "default": """欢迎来到游戏世界！

当前游戏状态：
- 玩家名称：{player_name}
- 生命值：{player_hp}
- 等级：{player_level}
- 当前场景：{current_scene}

请根据当前状态，为玩家提供合适的建议和指导。""",
        "battle": """战斗场景

玩家信息：
- 生命值：{player_hp}
- 等级：{player_level}

你正在与敌人战斗！请分析当前形势，给出战斗策略建议。""",
        "exploration": """探索场景

玩家 {player_name} 正在 {current_scene} 探索。

请描述周围的环境，并提示玩家可能发现的物品或遇到的事件。""",
        "dialogue": """对话场景

玩家 {player_name}（等级 {player_level}）正在与 NPC 对话。

请生成合适的对话内容，并根据玩家当前状态调整对话选项。""",
    }

    prompt_text = prompts.get(scenario, prompts["default"])

    # 填充游戏数据
    filled_prompt = prompt_text.format(
        player_name=GAME_DATA.get("player_name", "Unknown"),
        player_hp=GAME_DATA.get("player_hp", "0"),
        player_level=GAME_DATA.get("player_level", "1"),
        current_scene=GAME_DATA.get("current_scene", "unknown"),
    )

    logger.info(f"生成游戏提示词模板: {scenario}")

    return types.GetPromptResult(
        description=f"游戏{scenario}场景提示模板",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=filled_prompt),
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

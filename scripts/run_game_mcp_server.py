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
from urllib.parse import unquote
from loguru import logger
from mcp.server.fastmcp import FastMCP
import mcp.types as types
from magic_book.mcp import mcp_config
from pydantic import BaseModel
from fastapi import Request, Response


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

    def find_actor(self, actor_name: str) -> Actor | None:
        """递归查找指定名称的Actor

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            找到的Actor对象，如果未找到则返回None
        """
        # 在当前场景的actors中查找
        for actor in self.actors:
            if actor.name == actor_name:
                return actor

        # 递归搜索子场景中的actors
        for stage in self.stages:
            found = stage.find_actor(actor_name)
            if found:
                return found

        return None


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str
    description: str
    stages: List[Stage]

    def find_stage(self, stage_name: str) -> Stage | None:
        """递归查找指定名称的Stage

        Args:
            stage_name: 要查找的Stage名称

        Returns:
            找到的Stage对象，如果未找到则返回None
        """

        def _recursive_find(stages: List[Stage], target_name: str) -> Stage | None:
            for stage in stages:
                if stage.name == target_name:
                    return stage
                # 递归搜索子场景
                if stage.stages:
                    found = _recursive_find(stage.stages, target_name)
                    if found:
                        return found
            return None

        return _recursive_find(self.stages, stage_name)

    def find_actor_with_stage(
        self, actor_name: str
    ) -> tuple[Actor | None, Stage | None]:
        """查找指定名称的Actor及其所在的Stage

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            (Actor, Stage)元组，如果未找到则返回(None, None)
        """

        def _recursive_search(
            stages: List[Stage],
        ) -> tuple[Actor | None, Stage | None]:
            for stage in stages:
                # 先在当前Stage的actors中直接查找
                for actor in stage.actors:
                    if actor.name == actor_name:
                        return actor, stage

                # 递归搜索子场景
                if stage.stages:
                    found_actor, found_stage = _recursive_search(stage.stages)
                    if found_actor and found_stage:
                        return found_actor, found_stage

            return None, None

        return _recursive_search(self.stages)


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
                            description="精灵族的德鲁伊长老，他精通自然魔法，能与森林中的生物沟通。",
                            appearance="身穿绿色长袍的高大精灵，银白色的长发及腰，碧绿的眼眸中闪烁着智慧的光芒，手持一根雕刻着古老符文的木杖",
                        ),
                        Actor(
                            name="索尔娜·影舞",
                            description="神秘的暗夜精灵游侠，是森林的守护者。她在区域间穿梭巡逻，行踪飘忽，箭术精湛，总是在危险来临前出现。",
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
async def get_world_entity(name: str) -> str:
    """
    根据名称获取游戏世界实体（World、Stage或Actor）的完整数据

    Args:
        name: 实体名称（可以是World名称、Stage名称或Actor名称）

    Returns:
        对应实体的完整JSON数据，包含所有嵌套信息
    """
    try:
        # 检查是否是World
        if name == game_world.name:
            logger.info(f"获取World数据: {name}")
            return game_world.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Stage
        stage = game_world.find_stage(name)
        if stage:
            logger.info(f"获取Stage数据: {name}")
            return stage.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Actor
        actor, _ = game_world.find_actor_with_stage(name)
        if actor:
            logger.info(f"获取Actor数据: {name}")
            return actor.model_dump_json(indent=2, ensure_ascii=False)

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
        actor, current_stage = game_world.find_actor_with_stage(actor_name)
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
        target_stage = game_world.find_stage(target_stage_name)
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
        if decoded_resource_id == game_world.name:
            logger.info(f"获取World数据: {decoded_resource_id}")
            return game_world.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Stage
        stage = game_world.find_stage(decoded_resource_id)
        if stage:
            logger.info(f"获取Stage数据: {decoded_resource_id}")
            return stage.model_dump_json(indent=2, ensure_ascii=False)

        # 尝试查找Actor
        actor, _ = game_world.find_actor_with_stage(decoded_resource_id)
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

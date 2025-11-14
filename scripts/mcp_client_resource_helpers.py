#!/usr/bin/env python3
"""
MCP 客户端资源读取辅助函数模块

提供统一的资源读取接口,自动处理服务器返回的统一响应格式:
{
    "data": {...} 或 null,
    "error": "..." 或 null,
    "timestamp": "ISO格式时间戳"
}

功能:
- 自动解析统一响应格式
- 统一错误处理和异常抛出
- 统一日志记录
- 返回纯净的数据部分

使用示例:
    from mcp_client_resource_helpers import read_actor_resource

    actor_data = await read_actor_resource(mcp_client, "角色名")
    print(actor_data["name"])  # 直接访问数据字段
"""

import json
from typing import Any, Dict
from loguru import logger
from ai_trpg.mcp import (
    McpClient,
)


# async def read_world_resource(mcp_client: McpClient) -> Dict[str, Any]:
#     """
#     读取游戏世界(World)资源

#     Args:
#         mcp_client: MCP 客户端实例

#     Returns:
#         World数据字典 (不包含外层的 data/error/timestamp 包装)

#     Raises:
#         ValueError: 当资源读取失败或服务器返回错误时
#     """
#     world_resource_uri = "game://world"

#     try:
#         # 读取资源
#         world_resource_response = await mcp_client.read_resource(world_resource_uri)
#         if world_resource_response is None or world_resource_response.text is None:
#             raise ValueError(f"未能读取资源: {world_resource_uri}")

#         # 解析统一响应格式
#         response_data: Dict[str, Any] = json.loads(world_resource_response.text)

#         # 检查错误
#         if response_data.get("error") is not None:
#             error_msg = response_data["error"]
#             logger.error(f"❌ 服务器返回错误: {error_msg}")
#             logger.error(f"⏰ 时间戳: {response_data.get('timestamp')}")
#             raise ValueError(f"读取世界资源失败: {error_msg}")

#         # 返回数据部分
#         world_data = response_data.get("data")
#         if world_data is None:
#             raise ValueError("世界数据为空")

#         if not isinstance(world_data, dict):
#             raise ValueError("世界数据格式错误: 期望字典类型")

#         logger.debug(f"✅ 成功读取世界资源: {world_resource_uri}")
#         return world_data

#     except json.JSONDecodeError as e:
#         logger.error(f"❌ JSON解析失败: {e}")
#         raise ValueError(f"无效的JSON响应: {world_resource_uri}")


async def read_actor_resource(mcp_client: McpClient, actor_name: str) -> Dict[str, Any]:
    """
    读取角色(Actor)资源

    Args:
        mcp_client: MCP 客户端实例
        actor_name: 角色名称

    Returns:
        Actor数据字典 (不包含外层的 data/error/timestamp 包装)

    Raises:
        ValueError: 当资源读取失败或服务器返回错误时
    """
    actor_resource_uri = f"game://actor/{actor_name}"

    try:
        # 读取资源
        actor_resource_response = await mcp_client.read_resource(actor_resource_uri)
        if actor_resource_response is None or actor_resource_response.text is None:
            raise ValueError(f"未能读取资源: {actor_resource_uri}")

        # 解析统一响应格式
        response_data: Dict[str, Any] = json.loads(actor_resource_response.text)

        # 检查错误
        if response_data.get("error") is not None:
            error_msg = response_data["error"]
            logger.error(f"❌ 服务器返回错误: {error_msg}")
            logger.error(f"⏰ 时间戳: {response_data.get('timestamp')}")
            raise ValueError(f"读取角色资源失败: {error_msg}")

        # 返回数据部分
        actor_data = response_data.get("data")
        if actor_data is None:
            raise ValueError(f"角色 '{actor_name}' 数据为空")

        if not isinstance(actor_data, dict):
            raise ValueError(f"角色 '{actor_name}' 数据格式错误: 期望字典类型")

        # logger.debug(f"✅ 成功读取角色资源: {actor_name}")
        return actor_data

    except json.JSONDecodeError as e:
        logger.error(f"❌ JSON解析失败: {e}")
        raise ValueError(f"无效的JSON响应: {actor_resource_uri}")


async def read_stage_resource(mcp_client: McpClient, stage_name: str) -> Dict[str, Any]:
    """
    读取场景(Stage)资源

    Args:
        mcp_client: MCP 客户端实例
        stage_name: 场景名称

    Returns:
        Stage数据字典 (不包含外层的 data/error/timestamp 包装)

    Raises:
        ValueError: 当资源读取失败或服务器返回错误时
    """
    stage_resource_uri = f"game://stage/{stage_name}"

    try:
        # 读取资源
        stage_resource_response = await mcp_client.read_resource(stage_resource_uri)
        if stage_resource_response is None or stage_resource_response.text is None:
            raise ValueError(f"未能读取资源: {stage_resource_uri}")

        # 解析统一响应格式
        response_data: Dict[str, Any] = json.loads(stage_resource_response.text)

        # 检查错误
        if response_data.get("error") is not None:
            error_msg = response_data["error"]
            logger.error(f"❌ 服务器返回错误: {error_msg}")
            logger.error(f"⏰ 时间戳: {response_data.get('timestamp')}")
            raise ValueError(f"读取场景资源失败: {error_msg}")

        # 返回数据部分
        stage_data = response_data.get("data")
        if stage_data is None:
            raise ValueError(f"场景 '{stage_name}' 数据为空")

        if not isinstance(stage_data, dict):
            raise ValueError(f"场景 '{stage_name}' 数据格式错误: 期望字典类型")

        # logger.debug(f"✅ 成功读取场景资源: {stage_name}")
        return stage_data

    except json.JSONDecodeError as e:
        logger.error(f"❌ JSON解析失败: {e}")
        raise ValueError(f"无效的JSON响应: {stage_resource_uri}")

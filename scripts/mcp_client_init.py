#!/usr/bin/env python3
"""
MCP 客户端初始化模块

提供 MCP 客户端的初始化和配置功能。
"""

from loguru import logger
from ai_trpg.mcp import (
    create_mcp_client,
    McpClient,
    McpConfig,
)


async def create_mcp_client_with_config(
    mcp_config: McpConfig,
    list_available: bool,
    auto_connect: bool,
) -> McpClient:
    """初始化 MCP 客户端并获取所有可用资源

    Args:
        mcp_config: MCP 配置对象

    Returns:
        包含4个元素的元组: (mcp_client, available_tools, available_prompts, available_resources)

    Raises:
        Exception: 当 MCP 服务器连接失败时抛出异常
    """
    try:
        # 初始化 MCP 客户端
        mcp_client = await create_mcp_client(
            mcp_server_url=mcp_config.mcp_server_url,
            mcp_protocol_version=mcp_config.protocol_version,
            mcp_timeout=mcp_config.mcp_timeout,
            auto_connect=auto_connect,
        )

        if list_available:

            # 获取可用工具
            tools_result = await mcp_client.list_tools()
            available_tools = tools_result if tools_result is not None else []
            logger.debug(f"🔗 MCP 客户端连接成功，可用工具: {len(available_tools)}")
            for tool in available_tools:
                logger.debug(f"{tool.model_dump_json(indent=2, ensure_ascii=False)}")

            # 获取可用提示词模板
            prompts_result = await mcp_client.list_prompts()
            available_prompts = prompts_result if prompts_result is not None else []
            logger.debug(f"📝 获取到 {len(available_prompts)} 个提示词模板")
            for prompt in available_prompts:
                logger.debug(f"{prompt.model_dump_json(indent=2, ensure_ascii=False)}")

            # 获取可用资源
            resources_result = await mcp_client.list_resources()
            available_resources = (
                resources_result if resources_result is not None else []
            )
            logger.debug(f"📦 获取到 {len(available_resources)} 个资源")
            for resource in available_resources:
                logger.debug(
                    f"{resource.model_dump_json(indent=2, ensure_ascii=False)}"
                )

        return mcp_client

    except Exception as e:
        logger.error(f"❌ MCP 服务器连接失败: {e}")
        # logger.info("💡 请先启动 MCP 服务器: python scripts/run_game_mcp_server.py")
        raise

    # return None

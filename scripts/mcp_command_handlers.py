#!/usr/bin/env python3
"""
MCP 命令处理器模块

提供 MCP 相关的命令处理函数，包括工具、提示词、资源的列表显示和操作。
"""

import json
import traceback
from loguru import logger

from ai_trpg.mcp import McpClient
from ai_trpg.utils import parse_command_with_params


async def handle_tools_command(mcp_client: McpClient) -> None:
    """处理 /tools 命令:显示可用工具详情"""
    available_tools = await mcp_client.list_tools()
    assert available_tools is not None, "无法获取可用工具列表"
    if available_tools:
        output_lines = []
        output_lines.append("\n🛠️ 可用工具详情:")
        output_lines.append("-" * 50)
        for i, tool in enumerate(available_tools, 1):
            output_lines.append(f"{i}. {tool.name}")
            output_lines.append(f"   描述:{tool.description}")
            if tool.input_schema and "properties" in tool.input_schema:
                output_lines.append("   参数:")
                properties = tool.input_schema["properties"]
                required = tool.input_schema.get("required", [])
                for param_name, param_info in properties.items():
                    param_desc = param_info.get("description", "无描述")
                    is_required = " (必需)" if param_name in required else " (可选)"
                    output_lines.append(
                        f"     - {param_name}: {param_desc}{is_required}"
                    )
        logger.info("\n".join(output_lines))
    else:
        logger.warning("❌ 当前没有可用的工具")


async def handle_prompts_command(mcp_client: McpClient) -> None:
    """处理 /prompts 命令:显示可用的提示词模板"""
    available_prompts = await mcp_client.list_prompts()
    assert available_prompts is not None, "无法获取可用提示词模板列表"
    if available_prompts:
        output_lines = []
        output_lines.append("\n📝 可用提示词模板:")
        output_lines.append("-" * 50)
        for i, prompt in enumerate(available_prompts, 1):
            output_lines.append(f"{i}. {prompt.name}")
            if prompt.description:
                output_lines.append(f"   描述:{prompt.description}")
            if prompt.arguments:
                output_lines.append("   参数:")
                for arg in prompt.arguments:
                    arg_name = arg.get("name", "未知")
                    arg_desc = arg.get("description", "无描述")
                    arg_required = " (必需)" if arg.get("required") else " (可选)"
                    output_lines.append(f"     - {arg_name}: {arg_desc}{arg_required}")
        logger.info("\n".join(output_lines))
    else:
        logger.warning("📝 当前没有可用的提示词模板")


async def handle_resources_command(mcp_client: McpClient) -> None:
    """处理 /resources 命令:显示可用资源"""
    available_resources = await mcp_client.list_resources()
    assert available_resources is not None, "无法获取可用资源列表"
    if available_resources:
        output_lines = []
        output_lines.append("\n📦 可用资源列表:")
        output_lines.append("-" * 50)
        for i, resource in enumerate(available_resources, 1):
            output_lines.append(f"{i}. {resource.name}")
            output_lines.append(f"   URI: {resource.uri}")
            if resource.description:
                output_lines.append(f"   描述:{resource.description}")
            if resource.mime_type:
                output_lines.append(f"   类型:{resource.mime_type}")
        logger.info("\n".join(output_lines))
    else:
        logger.warning("📦 当前没有可用的资源")


async def handle_read_resource_command(user_input: str, mcp_client: McpClient) -> None:
    """处理 /read-resource 命令：读取指定资源

    Args:
        user_input: 用户输入的完整命令
        mcp_client: MCP客户端实例
    """
    # 解析资源名称
    parts = user_input.split(" ", 1)
    if len(parts) != 2 or not parts[1].strip():
        logger.error("💡 请提供资源名称，例如: /read-resource 资源名称")
        return

    resource_uri = parts[1].strip()
    logger.debug(f"📥 试图读取资源: {resource_uri}")

    try:
        resource_response = await mcp_client.read_resource(resource_uri)
        if resource_response is not None:
            logger.info(
                f"{resource_response.model_dump_json(indent=2, ensure_ascii=False)}"
            )

            if resource_response.text is not None:
                resource_data = json.loads(resource_response.text)
                logger.debug(
                    f"{json.dumps(resource_data, ensure_ascii=False, indent=2)}"
                )
        else:
            logger.error(f"❌ 未能读取资源: {resource_uri}")
    except Exception as e:
        logger.error(f"❌ 读取资源时发生错误: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")


async def handle_prompt_with_params_command(
    user_input: str, mcp_client: McpClient
) -> None:
    """处理参数化 Prompt 调用命令

    支持格式：command --param1=value1 --param2=value2 ...
    例如：game_system_prompt_example --player_name=张三 --current_stage=客厅

    Args:
        user_input: 用户输入的完整命令字符串
        mcp_client: MCP客户端实例
    """
    # 尝试解析命令行参数格式
    parsed_result = parse_command_with_params(user_input)
    if parsed_result is None:
        logger.warning(
            "💡 无法识别的输入格式\n"
            "支持的格式：\n"
            "  • /命令 [参数]\n"
            "  • 命令 --参数1=值1 --参数2=值2\n"
            "  • 输入 /help 查看所有可用命令"
        )
        return

    command, params = parsed_result

    # 打印解析结果
    logger.debug(f"命令行参数解析结果: command = {command}, params = \n{params}")

    # 从 MCP 服务器获取 Prompt 模板
    prompt_result = await mcp_client.get_prompt(name=command)
    if prompt_result is None:
        logger.warning(f"不是可用的提示词模板: {command}")
        return

    logger.debug(f"{prompt_result.model_dump_json(indent=2, ensure_ascii=False)}")

    # 提取并打印消息内容
    if prompt_result.messages:
        for i, message in enumerate(prompt_result.messages):
            logger.debug(f"{message.model_dump_json(indent=2, ensure_ascii=False)}")

    # 提取原始 Prompt 文本
    prompt_message = prompt_result.messages[0]
    prompt_text_raw = prompt_message.content.get("text", "")
    logger.debug(f"prompt_text_raw (原始JSON字符串) = {prompt_text_raw}")

    # 解析 JSON 字符串，提取真正的提示词模板
    try:
        prompt_data = json.loads(prompt_text_raw)
        # 从嵌套结构中提取核心的模板文本
        actual_prompt_template = str(prompt_data["messages"][0]["content"]["text"])

        logger.debug(f"✅ 提取到的核心提示词模板:\n{actual_prompt_template}")

        # 现在可以进行参数替换
        for key, value in params.items():
            placeholder = "{" + key + "}"
            actual_prompt_template = actual_prompt_template.replace(placeholder, value)

        logger.success(f"最终填充后的提示词:\n{actual_prompt_template}")

    except json.JSONDecodeError as e:
        logger.error(f"❌ 解析 prompt_text JSON 失败: {e}")
    except KeyError as e:
        logger.error(f"❌ 提取提示词模板失败，缺少键: {e}")

#!/usr/bin/env python3
"""
Game MCP 客户端 - 简化版 DeepSeek + MCP 聊天系统

功能：
1. 连接 Game MCP 服务器
2. 支持工具调用、资源读取、提示词使用
3. 提供交互式聊天界面
4. 支持对话历史查看

使用方法：
    python scripts/run_game_mcp_client.py
"""

import os
import sys

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

# 导入必要的模块
import traceback
from typing import Any, Final, List
import asyncio
from langchain.schema import HumanMessage, SystemMessage
from langgraph.graph.state import CompiledStateGraph
from loguru import logger

from magic_book.deepseek.mcp_client_graph import (
    McpState,
    create_mcp_workflow,
    execute_mcp_workflow,
)
from magic_book.deepseek.client import create_deepseek_llm
from magic_book.mcp import (
    McpClient,
    McpToolInfo,
    McpPromptInfo,
    McpResourceInfo,
    initialize_mcp_client,
    mcp_config,
)

world_name: Final[str] = "艾泽拉斯大陆"
player_actor_name: Final[str] = "艾尔温·星语"
game_master_system_prompt: str = (
    """你是一个游戏助手，帮助玩家了解游戏状态、提供建议和指导。"""
)

game_master_system_prompt = f"""# 你扮演一个奇幻世界游戏的管理员（Game Master）。

## 游戏世界

名称: {world_name}

## 玩家角色

名称: {player_actor_name}

## 你的职责：

负责引导玩家在名为 {world_name} 的虚拟世界中冒险。
你的任务是根据玩家 {player_actor_name} 的输入，
提供有趣且富有创意的回应，帮助他们理解游戏环境、任务和角色。"""

# ============================================================================
# 辅助函数
# ============================================================================


def print_chat_history(chat_history_state: McpState) -> None:
    """打印对话历史"""
    messages = chat_history_state["messages"]

    if not messages:
        logger.info("📜 对话历史为空")
        return

    logger.info("\n" + "=" * 60)
    logger.info("📜 对话历史：")
    logger.info("-" * 60)

    for i, message in enumerate(messages, 1):
        if isinstance(message, HumanMessage):
            logger.info(f"👤 用户 [{i}]: {message.content}")
        else:
            content = str(message.content)
            logger.info(f"🤖 DeepSeek [{i}]: {content}")

    logger.info(f"\n📊 统计信息：")
    logger.info(f"   • 总消息数: {len(messages)}")
    logger.info(
        f"   • 用户消息: {sum(1 for msg in messages if isinstance(msg, HumanMessage))}"
    )
    logger.info(
        f"   • AI回复: {sum(1 for msg in messages if not isinstance(msg, HumanMessage))}"
    )
    logger.info(f"   • 可用工具: {len(chat_history_state.get('available_tools', []))}")
    mcp_client = chat_history_state.get("mcp_client")
    logger.info(f"   • MCP状态: {'已连接' if mcp_client is not None else '未连接'}")
    logger.info("=" * 60)


def handle_tools_command(available_tools: List[McpToolInfo]) -> None:
    """处理 /tools 命令：显示可用工具详情"""
    if available_tools:
        logger.info("\n🛠️ 可用工具详情：")
        logger.info("-" * 50)
        for i, tool in enumerate(available_tools, 1):
            logger.info(f"{i}. {tool.name}")
            logger.info(f"   描述：{tool.description}")
            if tool.input_schema and "properties" in tool.input_schema:
                logger.info("   参数：")
                properties = tool.input_schema["properties"]
                required = tool.input_schema.get("required", [])
                for param_name, param_info in properties.items():
                    param_desc = param_info.get("description", "无描述")
                    is_required = " (必需)" if param_name in required else " (可选)"
                    logger.info(f"     - {param_name}: {param_desc}{is_required}")
    else:
        logger.warning("❌ 当前没有可用的工具")


def handle_prompts_command(available_prompts: List[McpPromptInfo]) -> None:
    """处理 /prompts 命令：显示可用的提示词模板"""
    if available_prompts:
        logger.info("\n📝 可用提示词模板：")
        logger.info("-" * 50)
        for i, prompt in enumerate(available_prompts, 1):
            logger.info(f"{i}. {prompt.name}")
            if prompt.description:
                logger.info(f"   描述：{prompt.description}")
            if prompt.arguments:
                logger.info("   参数：")
                for arg in prompt.arguments:
                    arg_name = arg.get("name", "未知")
                    arg_desc = arg.get("description", "无描述")
                    arg_required = " (必需)" if arg.get("required") else " (可选)"
                    logger.info(f"     - {arg_name}: {arg_desc}{arg_required}")
    else:
        logger.warning("📝 当前没有可用的提示词模板")


async def handle_resources_command(
    available_resources: List[McpResourceInfo], mcp_client: McpClient
) -> None:
    """处理 /resources 命令：显示和读取资源"""
    if available_resources:
        logger.info("\n📦 可用资源列表：")
        logger.info("-" * 50)
        for i, resource in enumerate(available_resources, 1):
            logger.info(f"{i}. {resource.name}")
            logger.info(f"   URI: {resource.uri}")
            if resource.description:
                logger.info(f"   描述：{resource.description}")
            if resource.mime_type:
                logger.info(f"   类型：{resource.mime_type}")

        # 询问是否读取某个资源
        logger.info("\n💡 提示：")
        logger.info("  • 输入资源编号 (1-N) 查看内容")
        logger.info("  • 输入自定义URI (如: game://dynamic/scene) 读取动态资源")
        logger.info("  • 直接回车跳过")
        choice = input("\n请选择: ").strip()

        if choice == "":
            return

        # 检查是否是数字（选择列表中的资源）
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(available_resources):
                selected_resource = available_resources[idx]
                logger.info(f"⏳ 正在读取资源: {selected_resource.name}")
                resource_uri = selected_resource.uri
            else:
                logger.error("❌ 无效的资源编号")
                return
        else:
            # 用户输入的是自定义 URI
            resource_uri = choice
            logger.info(f"⏳ 正在读取自定义资源: {resource_uri}")

        # 读取资源内容
        try:
            content = await mcp_client.read_resource(resource_uri)
            if content and content.text:
                logger.info("\n" + "=" * 60)
                logger.info(f"资源内容 ({resource_uri}):")
                logger.info("-" * 60)
                text = content.text
                if len(text) > 1000:
                    logger.info(text[:1000] + "\n...(内容过长，已截断)")
                else:
                    logger.info(text)
                logger.info("=" * 60)
            else:
                logger.error("❌ 无法读取资源内容")
        except Exception as e:
            logger.error(f"❌ 读取资源失败: {e}")
    else:
        logger.warning("📦 当前没有可用的资源")
        logger.info("💡 你仍然可以输入自定义URI (如: game://dynamic/player)")
        custom_uri = input("请输入资源URI（直接回车跳过）: ").strip()
        if custom_uri:
            logger.info(f"⏳ 正在读取自定义资源: {custom_uri}")
            try:
                content = await mcp_client.read_resource(custom_uri)
                if content and content.text:
                    logger.info("\n" + "=" * 60)
                    logger.info(f"资源内容 ({custom_uri}):")
                    logger.info("-" * 60)
                    logger.info(content.text)
                    logger.info("=" * 60)
                else:
                    logger.error("❌ 无法读取资源内容")
            except Exception as e:
                logger.error(f"❌ 读取资源失败: {e}")


def handle_help_command() -> None:
    """处理 /help 命令：显示帮助信息"""
    logger.info("\n" + "🎮" * 30)
    logger.info("🤖 Game MCP Client - 可用命令：")
    logger.info("-" * 60)
    logger.info("  /tools     - 查看可用工具")
    logger.info("  /resources - 查看可用资源")
    logger.info("  /prompts   - 查看提示词模板")
    logger.info("  /history   - 查看对话历史")
    logger.info("  /help      - 显示此帮助")
    logger.info("  /quit      - 退出程序")
    logger.info("🎮" * 30)


async def handle_user_message(
    user_input_state: McpState,
    chat_history_state: McpState,
    compiled_mcp_stage_graph: CompiledStateGraph[McpState, Any, McpState, McpState],
) -> None:
    """处理普通用户消息：发送给AI处理"""
    user_message = (
        user_input_state["messages"][0] if user_input_state.get("messages") else None
    )
    if user_message:
        logger.info(f"💬 处理用户输入: {user_message.content}")

    update_messages = await execute_mcp_workflow(
        state_compiled_graph=compiled_mcp_stage_graph,
        chat_history_state=chat_history_state,
        user_input_state=user_input_state,
    )

    # 更新聊天历史
    chat_history_state["messages"].extend(user_input_state["messages"])
    chat_history_state["messages"].extend(update_messages)

    # 显示最新的AI回复
    if update_messages:
        latest_response = update_messages[-1]
        logger.info(f"\n🤖 DeepSeek: {latest_response.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")


# ============================================================================
# 主函数
# ============================================================================


async def main() -> None:
    """Game MCP 客户端主函数"""
    logger.info("🎮 启动 Game MCP 客户端...")

    try:
        # 简化的欢迎信息
        logger.info("\n" + "🎮" * 30)
        logger.info("🤖 Game MCP Client - DeepSeek AI")
        logger.info("💡 输入 /help 查看命令 | 输入 /quit 退出")
        logger.info("🎮" * 30 + "\n")

        # 初始化 MCP 客户端
        mcp_client = None
        available_tools: List[McpToolInfo] = []
        available_prompts: List[McpPromptInfo] = []
        available_resources: List[McpResourceInfo] = []

        try:
            mcp_client = await initialize_mcp_client(
                mcp_server_url=mcp_config.mcp_server_url,
                mcp_protocol_version=mcp_config.protocol_version,
                mcp_timeout=mcp_config.mcp_timeout,
            )
            tools_result = await mcp_client.list_tools()
            available_tools = tools_result if tools_result is not None else []
            logger.success(f"🔗 MCP 客户端连接成功，可用工具: {len(available_tools)}")
            for tool in available_tools:
                logger.debug(f"{tool.model_dump_json(indent=2, ensure_ascii=False)}")

            prompts_result = await mcp_client.list_prompts()
            available_prompts = prompts_result if prompts_result is not None else []
            logger.success(f"📝 获取到 {len(available_prompts)} 个提示词模板")
            for prompt in available_prompts:
                logger.debug(f"{prompt.model_dump_json(indent=2, ensure_ascii=False)}")

            resources_result = await mcp_client.list_resources()
            available_resources = (
                resources_result if resources_result is not None else []
            )
            logger.success(f"📦 获取到 {len(available_resources)} 个资源")
            for resource in available_resources:
                logger.debug(
                    f"{resource.model_dump_json(indent=2, ensure_ascii=False)}"
                )

        except Exception as e:
            logger.error(f"❌ MCP 服务器连接失败: {e}")
            logger.info("💡 请先启动 MCP 服务器: python scripts/run_game_mcp_server.py")
            return

        # 创建 DeepSeek LLM 实例
        llm = create_deepseek_llm(0.7)
        logger.info("✅ DeepSeek LLM 实例创建成功")

        # 设置系统提示
        # system_prompt = """你是一个游戏助手，帮助玩家了解游戏状态、提供建议和指导。"""

        # 初始化聊天历史状态
        system_conversation_context: McpState = {
            "messages": [SystemMessage(content=game_master_system_prompt)],
            "llm": llm,
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        }

        # 创建工作流
        assert mcp_client is not None, "MCP client is not initialized"
        compiled_mcp_stage_graph = await create_mcp_workflow()

        logger.success("🤖 Game MCP 客户端初始化完成，开始对话...")

        # 对话循环
        while True:
            try:
                logger.info("\n" + "=" * 60)
                user_input = input("User: ").strip()

                # 处理退出命令
                if user_input.lower() in ["/quit", "/exit", "/q"]:
                    logger.info("👋 感谢使用 Game MCP 客户端！再见！")
                    break

                # 处理工具列表命令
                elif user_input.lower() == "/tools":
                    handle_tools_command(available_tools)
                    continue

                # 处理历史记录命令
                elif user_input.lower() == "/history":
                    print_chat_history(system_conversation_context)
                    continue

                # 处理提示词模板命令
                elif user_input.lower() == "/prompts":
                    handle_prompts_command(available_prompts)
                    continue

                # 处理资源列表命令
                elif user_input.lower() == "/resources":
                    await handle_resources_command(available_resources, mcp_client)
                    continue

                # 处理帮助命令
                elif user_input.lower() == "/help":
                    handle_help_command()
                    continue

                # 处理空输入
                elif user_input == "":
                    logger.warning("💡 请输入您的问题，或输入 /help 查看帮助")
                    continue

                # 处理普通用户消息
                user_input_state: McpState = {
                    "messages": [HumanMessage(content=user_input)],
                    "llm": llm,
                    "mcp_client": mcp_client,
                    "available_tools": available_tools,
                    "tool_outputs": [],
                }

                await handle_user_message(
                    user_input_state=user_input_state,
                    chat_history_state=system_conversation_context,
                    compiled_mcp_stage_graph=compiled_mcp_stage_graph,
                )

            except KeyboardInterrupt:
                logger.info("🛑 用户中断程序")
                logger.info("👋 程序已中断。再见！")
                break
            except Exception as e:
                logger.error(f"❌ 处理用户输入时发生错误: {e}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                logger.warning("请重试。")

    except Exception as e:
        logger.error(f"❌ 系统启动失败: {e}")
        logger.info("请检查以下项目：")
        logger.info("  1. DEEPSEEK_API_KEY 环境变量是否设置")
        logger.info("  2. 网络连接是否正常")
        logger.info("  3. 依赖包是否正确安装")
        logger.info("  4. MCP 服务器是否正在运行")

    finally:
        logger.info("🔒 清理系统资源...")
        if mcp_client:
            await mcp_client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

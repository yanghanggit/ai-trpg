#!/usr/bin/env python3
"""
DeepSeek + MCP 聊天系统启动脚本

功能：
1. 基于LangGraph构建的DeepSeek + MCP聊天机器人
2. 支持 Model Context Protocol (MCP) 工具调用
3. 支持连续对话和上下文记忆
4. 提供交互式聊天界面，包含工具功能演示

特性：
- 完全独立的MCP实现，不影响原有的DeepSeek Chat功能
- 简化版工具集：时间查询、系统信息
- 智能工具调用检测和执行
- 工具执行结果实时显示

使用方法：
    python scripts/run_deepseek_mcp_chat_client.py

或者在项目根目录下：
    python -m scripts.run_deepseek_mcp_chat_client



你好，你是谁？几点了？系统配置是多少？11 * 22 是多少？
"""

import os
import sys
import traceback
from typing import List


# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

# 导入必要的模块
import asyncio
from langchain.schema import HumanMessage, SystemMessage
from loguru import logger

from magic_book.deepseek.mcp_client_graph import (
    McpState,
    create_compiled_mcp_stage_graph,
    stream_mcp_graph_updates,
)
from magic_book.mcp import (
    McpToolInfo,
    McpPromptInfo,
    initialize_mcp_client,
    mcp_config,
)

# ============================================================================

# _mcp_config: Final[McpConfig] = load_mcp_config(Path("mcp_config.json"))


def print_welcome_message() -> None:
    """打印欢迎信息和功能说明"""
    print("\n" + "🚀" * 60)
    print("🤖 DeepSeek + MCP 聊天系统")
    print("📚 Model Context Protocol 增强版本")
    print("🚀" * 60)
    print("\n✨ 功能特性：")
    print("  • 智能对话：基于 DeepSeek AI 的强大对话能力")
    print("  • 工具调用：集成 MCP 工具，支持实用功能")
    print("  • 上下文记忆：维护完整的对话历史")
    print("  • 实时反馈：工具执行结果即时显示")

    print("\n🛠️ 内置工具（简化版）：")
    print("  • 时间查询：获取当前系统时间（多种格式）")
    print("  • 系统信息：获取操作系统、内存、磁盘等状态")

    print("\n💡 使用提示：")
    print("  • 你可以直接对话，AI会智能判断是否需要使用工具")
    print("  • 尝试说：'现在几点了？'、'查看系统状态'、'获取时间戳格式的时间'")
    print("  • 输入 /tools 查看可用工具详情")
    print("  • 输入 /prompts 查看可用提示词模板")
    print("  • 输入 /analyze 使用提示词模板进行系统分析")
    print("  • 输入 /history 查看对话历史")
    print("  • 输入 /quit、/exit 或 /q 退出程序")
    print("\n" + "🎯" * 60 + "\n")


def print_available_tools() -> None:
    """打印可用工具的详细信息"""
    print("\n🛠️ 可用工具详情：")
    print("-" * 50)
    print("工具信息将在连接到 MCP 服务器后显示")
    print(f"请确保 MCP 服务器正在运行 ({mcp_config.mcp_server_url})")
    print("启动命令: python scripts/run_sample_mcp_server.py")
    print()


def print_chat_history(chat_history_state: McpState) -> None:
    """打印对话历史"""
    messages = chat_history_state["messages"]

    if not messages:
        print("\n📜 对话历史为空")
        return

    print("\n📜 对话历史：")
    print("-" * 60)

    for i, message in enumerate(messages, 1):
        if isinstance(message, HumanMessage):
            print(f"👤 用户 [{i}]: {message.content}")
        else:
            # 截断过长的回复以便显示
            content = str(message.content)
            # if len(content) > 200:
            #     content = content[:200] + "..."
            print(f"🤖 DeepSeek [{i}]: {content}")
        print()

    print(f"📊 统计信息：")
    print(f"   • 总消息数: {len(messages)}")
    print(
        f"   • 用户消息: {sum(1 for msg in messages if isinstance(msg, HumanMessage))}"
    )
    print(
        f"   • AI回复: {sum(1 for msg in messages if not isinstance(msg, HumanMessage))}"
    )
    print(f"   • 可用工具: {len(chat_history_state.get('available_tools', []))}")
    mcp_client = chat_history_state.get("mcp_client")
    print(f"   • MCP状态: {'已连接' if mcp_client is not None else '未连接'}")
    print("-" * 60)


async def main() -> None:
    """
    DeepSeek + MCP 聊天系统主函数

    功能：
    1. 初始化 DeepSeek + MCP 聊天机器人
    2. 提供 MCP 工具调用能力
    3. 支持连续对话和上下文记忆
    4. 优雅的错误处理和用户体验
    """
    logger.info("🤖 启动 DeepSeek + MCP 聊天系统...")

    try:

        # 打印欢迎信息
        print_welcome_message()

        # 初始化 MCP 客户端和工具
        mcp_client = None
        available_tools: List[McpToolInfo] = []
        available_prompts: List[McpPromptInfo] = []

        try:
            mcp_client = await initialize_mcp_client(
                mcp_server_url=mcp_config.mcp_server_url,
                mcp_protocol_version=mcp_config.protocol_version,
                mcp_timeout=mcp_config.mcp_timeout,
            )
            tools_result = await mcp_client.list_tools()
            available_tools = tools_result if tools_result is not None else []
            logger.success(f"🔗 MCP 客户端连接成功，可用工具: {len(available_tools)}")

            # 获取可用的提示词模板
            prompts_result = await mcp_client.list_prompts()
            available_prompts = prompts_result if prompts_result is not None else []
            logger.success(f"📝 获取到 {len(available_prompts)} 个提示词模板")
        except Exception as e:
            logger.error(f"❌ MCP 服务器连接失败: {e}")
            logger.info(
                "💡 请确保 MCP 服务器正在运行: python scripts/run_sample_mcp_server.py --config mcp_config.json"
            )
            print("❌ MCP 服务器连接失败，程序退出")
            print(
                "请先启动 MCP 服务器: python scripts/run_sample_mcp_server.py --config mcp_config.json"
            )
            return

        # 设置系统提示
        system_prompt = (
            """# 你作为一个人工智能助手要扮演一个海盗，你需要用海盗的语气来回答问题。"""
        )

        # 初始化 MCP 聊天历史状态
        chat_history_state: McpState = {
            "messages": [SystemMessage(content=system_prompt)],
            "mcp_client": mcp_client,
            "available_tools": available_tools,
            "tool_outputs": [],
        }

        # 生成 MCP 增强的聊天机器人状态图
        assert mcp_client is not None, "MCP client is not initialized"
        compiled_mcp_stage_graph = await create_compiled_mcp_stage_graph(
            "mcp_stage_graph",
            mcp_client,
        )

        logger.success("🤖 DeepSeek + MCP 聊天系统初始化完成，开始对话...")

        while True:
            try:
                print("\n" + "=" * 60)
                user_input = input("User: ").strip()

                # 处理特殊命令
                if user_input.lower() in ["/quit", "/exit", "/q"]:
                    print("\n👋 感谢使用 DeepSeek + MCP 聊天系统！再见！")
                    break
                elif user_input.lower() == "/tools":
                    if available_tools:
                        print("\n🛠️ 可用工具详情：")
                        print("-" * 50)
                        for i, tool in enumerate(available_tools, 1):
                            print(f"{i}. {tool.name}")
                            print(f"   描述：{tool.description}")
                            if tool.input_schema and "properties" in tool.input_schema:
                                print("   参数：")
                                properties = tool.input_schema["properties"]
                                required = tool.input_schema.get("required", [])
                                for param_name, param_info in properties.items():
                                    param_desc = param_info.get("description", "无描述")
                                    is_required = (
                                        " (必需)"
                                        if param_name in required
                                        else " (可选)"
                                    )
                                    print(
                                        f"     - {param_name}: {param_desc}{is_required}"
                                    )
                            print()
                    else:
                        print_available_tools()
                    continue
                elif user_input.lower() == "/history":
                    print_chat_history(chat_history_state)
                    continue
                elif user_input.lower() == "/prompts":
                    # 显示可用的提示词模板
                    if available_prompts:
                        print("\n📝 可用提示词模板：")
                        print("-" * 50)
                        for i, prompt in enumerate(available_prompts, 1):
                            print(f"{i}. {prompt.name}")
                            if prompt.description:
                                print(f"   描述：{prompt.description}")
                            if prompt.arguments:
                                print("   参数：")
                                for arg in prompt.arguments:
                                    arg_name = arg.get("name", "未知")
                                    arg_desc = arg.get("description", "无描述")
                                    arg_required = (
                                        " (必需)" if arg.get("required") else " (可选)"
                                    )
                                    print(
                                        f"     - {arg_name}: {arg_desc}{arg_required}"
                                    )
                            print()
                    else:
                        print("\n📝 当前没有可用的提示词模板")
                    continue
                elif user_input.lower() == "/analyze":
                    # 使用提示词模板进行系统分析的演示
                    print("\n🔍 系统分析演示（使用提示词模板）")
                    print("-" * 50)
                    print("可选分析类型：")
                    print("  1. general - 综合分析")
                    print("  2. performance - 性能分析")
                    print("  3. security - 安全分析")
                    print("  4. troubleshooting - 故障诊断")

                    analysis_choice = input("\n请选择分析类型 (1-4): ").strip()
                    analysis_types = {
                        "1": "general",
                        "2": "performance",
                        "3": "security",
                        "4": "troubleshooting",
                    }

                    analysis_type = analysis_types.get(analysis_choice, "general")

                    try:
                        # 步骤1: 获取系统数据
                        print(f"\n⏳ 正在获取系统信息...")
                        system_data_result = await mcp_client.call_tool(
                            tool_name="system_info", arguments={}
                        )

                        if not system_data_result.success:
                            print(f"❌ 获取系统信息失败: {system_data_result.error}")
                            continue

                        # 步骤2: 获取提示词模板
                        print(f"⏳ 正在获取 {analysis_type} 分析模板...")
                        prompt_result = await mcp_client.get_prompt(
                            name="system_analysis",
                            arguments={"analysis_type": analysis_type},
                        )

                        if not prompt_result:
                            print("❌ 获取提示词模板失败")
                            continue

                        # 步骤3: 填充模板
                        prompt_message = prompt_result.messages[0]
                        prompt_text = prompt_message.content.get("text", "")
                        filled_prompt = prompt_text.replace(
                            "{system_data}", str(system_data_result.result)
                        )

                        print(f"\n✅ 提示词模板已准备完成")
                        print(f"📊 分析类型: {analysis_type}")
                        print(f"📝 模板名称: system_analysis")
                        print(f"📋 角色: {prompt_message.role}")
                        print("\n" + "=" * 60)
                        print("生成的完整提示词预览（前800字符）：")
                        print("-" * 60)
                        print(
                            filled_prompt[:800] + "..."
                            if len(filled_prompt) > 800
                            else filled_prompt
                        )
                        print("=" * 60)

                        # 步骤4: 询问是否发送给AI分析
                        should_analyze = (
                            input("\n是否将此提示词发送给AI进行分析？(y/n): ")
                            .strip()
                            .lower()
                        )

                        if should_analyze == "y":
                            # 创建用户输入状态
                            analysis_input_state: McpState = {
                                "messages": [HumanMessage(content=filled_prompt)],
                                "mcp_client": mcp_client,
                                "available_tools": available_tools,
                                "tool_outputs": [],
                            }

                            # 获取 AI 分析
                            print("\n⏳ AI 正在分析...")
                            update_messages = await stream_mcp_graph_updates(
                                state_compiled_graph=compiled_mcp_stage_graph,
                                chat_history_state=chat_history_state,
                                user_input_state=analysis_input_state,
                            )

                            # 更新聊天历史
                            chat_history_state["messages"].extend(
                                analysis_input_state["messages"]
                            )
                            chat_history_state["messages"].extend(update_messages)

                            # 显示分析结果
                            if update_messages:
                                latest_response = update_messages[-1]
                                print(f"\n🤖 AI 分析结果：")
                                print("=" * 60)
                                print(latest_response.content)
                                print("=" * 60)
                            else:
                                print("\n❌ 没有收到分析结果")
                        else:
                            print("✋ 已取消分析")

                    except Exception as e:
                        logger.error(f"系统分析演示出错: {e}")
                        print(f"\n❌ 分析过程出错: {e}")

                    continue
                elif user_input.lower() == "/help":
                    print_welcome_message()
                    continue
                elif user_input == "":
                    print("💡 请输入您的问题，或输入 /help 查看帮助")
                    continue

                # 用户输入状态
                user_input_state: McpState = {
                    "messages": [HumanMessage(content=user_input)],
                    "mcp_client": mcp_client,
                    "available_tools": available_tools,
                    "tool_outputs": [],
                }

                # 获取 AI 回复（包含可能的工具调用）
                logger.info(f"处理用户输入: {user_input}")
                update_messages = await stream_mcp_graph_updates(
                    state_compiled_graph=compiled_mcp_stage_graph,
                    chat_history_state=chat_history_state,
                    user_input_state=user_input_state,
                )

                # 更新聊天历史（包含用户输入和AI回复）
                chat_history_state["messages"].extend(user_input_state["messages"])
                chat_history_state["messages"].extend(update_messages)

                # 显示最新的AI回复
                if update_messages:
                    latest_response = update_messages[-1]
                    print(f"\n🤖 DeepSeek: {latest_response.content}")
                else:
                    print("\n❌ 抱歉，没有收到回复。")

                # 提示用户可以使用 /history 查看对话历史
                logger.debug(
                    f"💬 当前对话历史包含 {len(chat_history_state['messages'])} 条消息，使用 /history 查看详情"
                )

            except KeyboardInterrupt:
                logger.info("🛑 [MAIN] 用户中断程序")
                print("\n\n👋 程序已中断。再见！")
                break
            except Exception as e:
                logger.error(
                    f"❌ 处理用户输入时发生错误: {e}\n"
                    f"Traceback: {traceback.format_exc()}"
                )
                print("\n❌ 抱歉，处理您的请求时发生错误，请重试。")

    except Exception as e:
        logger.error(f"❌ [MAIN] 系统启动失败: {e}")
        print(f"\n❌ 系统启动失败：{e}")
        print("请检查以下项目：")
        print("  1. DEEPSEEK_API_KEY 环境变量是否设置")
        print("  2. 网络连接是否正常")
        print("  3. 依赖包是否正确安装")
        print("  4. MCP 服务器是否正在运行")

    finally:
        logger.info("🔒 [MAIN] 清理系统资源...")
        if mcp_client:
            await mcp_client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

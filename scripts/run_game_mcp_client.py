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
from langchain.schema import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph.state import CompiledStateGraph
from loguru import logger

from magic_book.deepseek.mcp_client_graph import (
    McpState,
    create_mcp_workflow,
    execute_mcp_workflow,
)
from magic_book.deepseek.client import create_deepseek_llm
from magic_book.mcp import (
    McpToolInfo,
    McpPromptInfo,
    McpResourceInfo,
    initialize_mcp_client,
    mcp_config,
    McpClient,
)
import json
from magic_book.demo.test_world import test_world, Actor, World, Stage
from pydantic import BaseModel


def _gen_admin_system_message(world: World) -> str:
    return f"""# 游戏管理员

你负责管理和维护游戏世界的秩序与运行，你是游戏的最高管理者。

## 游戏世界

名称: {world.name}
描述: {world.description}

## 游戏规则

- 世界构成：只有一个World, 而 World 包含多个 Stage，每个 Stage 包含多个 Actor 和 子Stages。
- 核心规则：Actor 必须所在某个 Stage 中。在 Stage 中，Actor 可以与其他 Actor 互动。

## 你的职责：
- 你需要根据玩家的指令，管理游戏世界的状态。
- 你可以添加、删除或修改 Actor 和 Stage。
- 你需要确保游戏世界的逻辑一致性和规则遵守。
- 你需要根据玩家的指令，提供游戏世界的最新状态信息。

## 输出要求

将你的回复内容组成成 markeddown 格式的文本块，方便阅读。"""


def _gen_actor_system_message(actor_model: Actor, world: World) -> str:
    return f"""# {actor_model.name}

你扮演这个游戏世界的一个角色：{actor_model.name} 

## 人物设定：

{actor_model.character_profile}

## 外观信息

{actor_model.appearance}

## 世界设定

名称: {world.name}
描述: {world.description}

## 你的职责：
- 你需要根据你的角色设定，做出符合角色身份的回应。
- 你可以与其他角色互动，探索场景，完成任务。
- 你的回应应当推动故事发展，增加游戏的趣味性和沉浸感。

## 输出要求

将你的回复内容组成成 markeddown 格式的文本块，方便阅读。"""


def _gen_stage_system_message(stage_model: Stage, world: World) -> str:
    return f"""# 场景: {stage_model.name}

你扮演这个游戏世界的一个场景: {stage_model.name}

## 场景描述：

{stage_model.description}

## 场景环境描写

{stage_model.environment}

## 世界设定

名称: {world.name}
描述: {world.description}

## 你的职责：
- 你需要根据你的场景设定，描述场景中的环境和氛围。
- 你可以描述场景中的角色互动，事件发生等。
- 你的描述应当推动故事发展，增加游戏的趣味性和沉浸感。

## 输出要求

将你的回复内容组成成 markeddown 格式的文本块，方便阅读。"""


class GameAgent(BaseModel):
    name: str
    type: str
    chat_history: List[BaseMessage] = []


# 创建游戏角色代理
admin_agent: Final[GameAgent] = GameAgent(
    name="游戏管理员",
    type=World.__name__,
    chat_history=[SystemMessage(content=_gen_admin_system_message(test_world))],
)

# 获取游戏世界中的所有角色
all_actors = test_world.get_all_actors()
logger.info(f"游戏世界中的所有角色: {[actor.name for actor in all_actors]}")

all_stages = test_world.get_all_stages()
logger.info(f"游戏世界中的所有场景: {[stage.name for stage in all_stages]}")

# 创建每个角色的代理
actor_agents: List[GameAgent] = []
for actor in all_actors:
    agent = GameAgent(
        name=actor.name,
        type=Actor.__name__,
        chat_history=[
            SystemMessage(content=_gen_actor_system_message(actor, test_world))
        ],
    )
    actor_agents.append(agent)

stage_agents: List[GameAgent] = []
for stage in all_stages:
    agent = GameAgent(
        name=stage.name,
        type=Stage.__name__,
        chat_history=[
            SystemMessage(content=_gen_stage_system_message(stage, test_world))
        ],
    )
    stage_agents.append(agent)


# 所有代理列表
all_agents: List[GameAgent] = [admin_agent] + actor_agents + stage_agents

for agent in all_agents:
    logger.info(f"已创建代理: {agent.name}")


# ============================================================================
# 辅助函数
# ============================================================================


def parse_command_with_params(user_input: str) -> tuple[str, dict[str, str]] | None:
    """解析命令行参数格式的输入

    支持格式：command --param1=value1 --param2=value2 ...

    Args:
        user_input: 用户输入的字符串

    Returns:
        如果是命令格式，返回 (command, params_dict)
        如果不是命令格式，返回 None

    Examples:
        >>> parse_command_with_params("move --actor=张三 --stage=客厅")
        ('move', {'actor': '张三', 'stage': '客厅'})

        >>> parse_command_with_params("query --verbose")
        ('query', {'verbose': 'true'})
    """
    # 检查是否包含 -- 参数格式
    if " --" not in user_input:
        return None

    # 分割命令和参数
    parts = user_input.split()
    if not parts:
        return None

    command = parts[0]  # 第一个部分是命令

    # 解析参数
    params: dict[str, str] = {}
    for part in parts[1:]:
        if part.startswith("--"):
            # 移除 -- 前缀并分割键值对
            param_str = part[2:]  # 去掉 --
            if "=" in param_str:
                key, value = param_str.split("=", 1)
                params[key] = value
            else:
                # 如果没有 =，则视为标志参数（值为 true）
                params[param_str] = "true"

    return (command, params)


def print_chat_history(messages: List[BaseMessage]) -> None:
    """打印对话历史"""

    if not messages:
        logger.info("📜 对话历史为空")
        return

    # logger.info("\n" + "=" * 60)
    logger.info(f"📜 对话历史：数量 = {len(messages)}")
    # logger.info("-" * 60)

    for i, message in enumerate(messages):
        if isinstance(message, HumanMessage):
            logger.debug(f"👤 HumanMessage [{i}]: {message.content}")
        elif isinstance(message, SystemMessage):
            logger.debug(f"⚙️ SystemMessage [{i}]: {message.content}")
        elif isinstance(message, AIMessage):
            logger.debug(f"🤖 AIMessage [{i}]: {message.content}")

    # logger.info("=" * 60)


def handle_tools_command(available_tools: List[McpToolInfo]) -> None:
    """处理 /tools 命令:显示可用工具详情"""
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


def handle_prompts_command(available_prompts: List[McpPromptInfo]) -> None:
    """处理 /prompts 命令:显示可用的提示词模板"""
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


def handle_resources_command(available_resources: List[McpResourceInfo]) -> None:
    """处理 /resources 命令:显示可用资源"""
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


def handle_help_command() -> None:
    """处理 /help 命令：显示帮助信息"""
    logger.info("\n" + "🎮" * 30)
    logger.info("🤖 Game MCP Client - 可用命令：")
    logger.info("-" * 60)
    logger.info("  /tools     - 查看可用工具")
    logger.info("  /resources - 查看可用资源")
    logger.info("  /prompts   - 查看提示词模板")
    logger.info("  /history   - 查看对话历史")
    # logger.info("  /system    - 执行系统指令（让AI主动获取游戏状态）")
    logger.info("  /help      - 显示此帮助")
    logger.info("  /quit      - 退出程序")
    logger.info("🎮" * 30)


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


async def handle_user_message(
    user_input_state: McpState,
    chat_history_state: McpState,
    compiled_mcp_stage_graph: CompiledStateGraph[McpState, Any, McpState, McpState],
    should_append_to_history: bool = True,
) -> List[BaseMessage]:
    """处理普通用户消息：发送给AI处理"""
    user_message = (
        user_input_state["messages"][0] if user_input_state.get("messages") else None
    )
    if user_message:
        logger.success(f"💬 处理用户输入: {user_message.content}")

    update_messages = await execute_mcp_workflow(
        state_compiled_graph=compiled_mcp_stage_graph,
        chat_history_state=chat_history_state,
        user_input_state=user_input_state,
    )

    # 更新聊天历史
    if should_append_to_history:
        chat_history_state["messages"].extend(user_input_state["messages"])
        chat_history_state["messages"].extend(update_messages)

    # 显示最新的AI回复
    if update_messages:
        for msg in update_messages:
            assert isinstance(msg, AIMessage)
            logger.debug(f"{msg.content}")
    else:
        logger.error("❌ 抱歉，没有收到回复。")

    return update_messages


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


# ============================================================================
# 主函数
# ============================================================================


async def main() -> None:
    """Game MCP 客户端主函数"""
    logger.success("🎮 启动 Game MCP 客户端...")

    # 当前的代理（默认为游戏管理员）
    current_agent: GameAgent = admin_agent

    try:
        # 简化的欢迎信息
        logger.info("\n" + "🎮" * 30)
        logger.info("💡 输入 /help 查看命令 | 输入 /quit 退出")
        logger.info("🎮" * 30 + "\n")

        # 初始化 MCP 客户端
        mcp_client = None
        available_tools: List[McpToolInfo] = []
        available_prompts: List[McpPromptInfo] = []
        available_resources: List[McpResourceInfo] = []

        try:

            # Initialize MCP client
            mcp_client = await initialize_mcp_client(
                mcp_server_url=mcp_config.mcp_server_url,
                mcp_protocol_version=mcp_config.protocol_version,
                mcp_timeout=mcp_config.mcp_timeout,
            )

            # 获取可用工具
            tools_result = await mcp_client.list_tools()
            available_tools = tools_result if tools_result is not None else []
            logger.success(f"🔗 MCP 客户端连接成功，可用工具: {len(available_tools)}")
            for tool in available_tools:
                logger.debug(f"{tool.model_dump_json(indent=2, ensure_ascii=False)}")

            # 获取可用提示词模板
            prompts_result = await mcp_client.list_prompts()
            available_prompts = prompts_result if prompts_result is not None else []
            logger.success(f"📝 获取到 {len(available_prompts)} 个提示词模板")
            for prompt in available_prompts:
                logger.debug(f"{prompt.model_dump_json(indent=2, ensure_ascii=False)}")

            # 获取可用资源
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
        logger.debug("✅ DeepSeek LLM 实例创建成功")

        # 创建工作流
        assert mcp_client is not None, "MCP client is not initialized"
        compiled_mcp_stage_graph = await create_mcp_workflow()

        # 对话循环
        while True:

            try:
                logger.info("\n" + "=" * 60)
                user_input = input(f"[{current_agent.name}]:").strip()

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
                    logger.info(f"📜 打印当前代理 [{current_agent.name}] 的对话历史")
                    print_chat_history(current_agent.chat_history)
                    continue

                # 处理提示词模板命令
                elif user_input.lower() == "/prompts":
                    handle_prompts_command(available_prompts)
                    continue

                # 处理资源列表命令
                elif user_input.lower() == "/resources":
                    handle_resources_command(available_resources)
                    continue

                # 处理帮助命令
                elif user_input.lower() == "/help":
                    handle_help_command()
                    continue

                # 复杂输入的处理：读取资源
                elif user_input.startswith("/read-resource"):
                    await handle_read_resource_command(user_input, mcp_client)
                    continue

                elif user_input.startswith("@"):

                    # @名字。请提取出来
                    target_name = user_input[1:]
                    if not target_name:
                        logger.error("💡 请输入有效的角色名字")
                        continue

                    logger.info(f"🎭 角色名字: {target_name}")
                    if target_name == current_agent.name:
                        logger.warning("⚠️ 你已经是该角色代理，无需切换")
                        continue

                    last_agent_name = current_agent.name
                    switched = False

                    for agent in all_agents:
                        if agent.name == target_name:
                            current_agent = agent
                            assert current_agent is not None
                            logger.success(
                                f"✅ 切换当前代理 {last_agent_name} 到 {current_agent.name}"
                            )
                            switched = True
                            break

                    if not switched:
                        logger.error(f"❌ 未找到角色代理: {target_name}")

                    continue

                elif parse_command_with_params(user_input) is not None:
                    # 处理参数化 Prompt 调用
                    await handle_prompt_with_params_command(user_input, mcp_client)
                    continue

                # 处理空输入
                if user_input == "":
                    logger.error("💡 请输入您的问题，或输入 /help 查看帮助")
                    continue

                # 最后的兜底处理, 纯聊天！
                response = await handle_user_message(
                    user_input_state={
                        "messages": [HumanMessage(content=user_input)],
                        "llm": llm,
                        "mcp_client": mcp_client,
                        "available_tools": available_tools,
                        "tool_outputs": [],
                    },
                    chat_history_state={
                        "messages": current_agent.chat_history.copy(),
                        "llm": llm,
                        "mcp_client": mcp_client,
                        "available_tools": available_tools,
                        "tool_outputs": [],
                    },
                    compiled_mcp_stage_graph=compiled_mcp_stage_graph,
                )

                # 更新当前代理的对话历史
                current_agent.chat_history.append(HumanMessage(content=user_input))
                current_agent.chat_history.extend(response)

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

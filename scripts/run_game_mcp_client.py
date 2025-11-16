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
import asyncio
from langchain.schema import HumanMessage
from loguru import logger

from ai_trpg.deepseek import (
    create_deepseek_llm,
)

from ai_trpg.mcp import (
    mcp_config,
)

from ai_trpg.demo import (
    get_demo_world_name,
)

from ai_trpg.utils import parse_command_with_params
from ai_trpg.rag.pgvector_game_retriever import PGVectorGameDocumentRetriever
from ai_trpg.configuration.logging_config import setup_logger

# 导入本地工具模块
from agent_utils import GameWorld, get_agent_context
from mcp_command_handlers import (
    handle_tools_command,
    handle_prompts_command,
    handle_resources_command,
    handle_read_resource_command,
    handle_prompt_with_params_command,
)
from workflow_handlers import (
    handle_mcp_workflow_execution,
    handle_chat_workflow_execution,
    handle_rag_workflow_execution,
)
from io_utils import format_user_input_prompt, log_history, dump_history
from mcp_client_init import create_mcp_client_with_config
from gameplay_handler import handle_game_command


# ============================================================================
# 主函数
# ============================================================================
async def main() -> None:

    try:

        # 设定日志配置
        setup_logger()

        # 初始化 MCP 客户端并获取可用资源
        mcp_client = await create_mcp_client_with_config(
            mcp_config=mcp_config, list_available=True, auto_connect=True
        )
        assert mcp_client is not None, "MCP 客户端初始化失败"

        # 创建游戏代理管理器 (从数据库加载)
        game_world: GameWorld = GameWorld()
        await game_world.load(
            world_name=get_demo_world_name(),
        )

        # 验证代理管理器已正确初始化
        if game_world.current_agent is None:
            raise ValueError("❌ 代理管理器未正确初始化")

        # 连接所有代理的 MCP 客户端
        await game_world.connect_all_agents()

        # 对话循环
        while True:

            user_input = input(f"[{game_world.current_agent.name}]:").strip()

            # 处理退出命令
            if user_input.lower() in ["/quit", "/exit", "/q"]:
                logger.info("👋 感谢使用 Game MCP 客户端！再见！")
                break

            # 处理工具列表命令
            elif user_input.lower() == "/tools":
                await handle_tools_command(mcp_client)
                continue

            # 处理历史记录命令
            elif user_input.lower() == "/log":
                logger.info(
                    f"📜 打印当前代理 [{game_world.current_agent.name}] 的对话历史"
                )
                current_context = get_agent_context(game_world.current_agent)
                log_history(
                    agent_name=game_world.current_agent.name,
                    messages=current_context,
                )
                continue

            elif user_input.lower() == "/dump":
                for game_agent in game_world.all_agents:
                    logger.debug(f"💾 保存代理 [{game_agent.name}] 的对话历史")
                    agent_context = get_agent_context(game_agent)
                    dump_history(
                        agent_name=game_agent.name,
                        messages=agent_context,
                    )

                continue

            # 处理提示词模板命令
            elif user_input.lower() == "/prompts":
                await handle_prompts_command(mcp_client)
                continue

            # 处理资源列表命令
            elif user_input.lower() == "/resources":
                await handle_resources_command(mcp_client)
                continue

            # 复杂输入的处理：读取资源
            elif user_input.startswith("/read-resource"):
                await handle_read_resource_command(user_input, mcp_client)
                continue

            elif user_input.startswith("@"):

                # 提取目标代理名称
                target_name = user_input[1:].strip()
                if not target_name:
                    logger.error("💡 请输入有效的角色名字，格式: @角色名")
                    continue

                logger.info(f"🎭 尝试切换到代理: {target_name}")

                # 使用代理管理器切换代理
                game_world.switch_current_agent(target_name)

                continue

            elif user_input.startswith("/mcp"):

                mcp_content = user_input[len("/mcp") :].strip()
                if not mcp_content:
                    logger.error("💡 请输入有效的内容，格式: /mcp 内容")
                    continue

                # 格式化用户输入
                format_user_input = format_user_input_prompt(mcp_content)

                # 从数据库读取上下文
                current_context = get_agent_context(game_world.current_agent)

                # mcp 的工作流
                mcp_response = await handle_mcp_workflow_execution(
                    agent_name=game_world.current_agent.name,
                    context=current_context,
                    request=HumanMessage(content=format_user_input),
                    llm=create_deepseek_llm(),
                    mcp_client=mcp_client,
                    re_invoke_instruction=None,
                    skip_re_invoke=False,
                )

                # 更新当前代理的对话历史
                # current_agent.context.append(HumanMessage(content=format_user_input))
                # current_agent.context.extend(mcp_response)
                continue

            elif user_input.startswith("/chat"):

                chat_content = user_input[len("/chat") :].strip()
                if not chat_content:
                    logger.error("💡 请输入有效的内容，格式: /chat 内容")
                    continue

                # 格式化用户输入
                format_user_input = format_user_input_prompt(chat_content)

                # 从数据库读取上下文
                current_context = get_agent_context(game_world.current_agent)

                # 聊天的工作流
                chat_response = await handle_chat_workflow_execution(
                    agent_name=game_world.current_agent.name,
                    context=current_context,
                    request=HumanMessage(content=format_user_input),
                    llm=create_deepseek_llm(),
                )

                # 更新当前代理的对话历史
                # current_agent.context.append(HumanMessage(content=format_user_input))
                # current_agent.context.extend(chat_response)
                continue

            elif user_input.startswith("/rag"):

                rag_content = user_input[len("/rag") :].strip()
                if not rag_content:
                    logger.error("💡 请输入有效的内容，格式: /rag 内容")
                    continue

                # 从数据库读取上下文
                current_context = get_agent_context(game_world.current_agent)

                # RAG 的工作流
                rag_response = await handle_rag_workflow_execution(
                    agent_name=game_world.current_agent.name,
                    context=current_context,
                    request=HumanMessage(content=rag_content),
                    llm=create_deepseek_llm(),
                    document_retriever=PGVectorGameDocumentRetriever(),
                )

                # 更新当前代理的对话历史
                # current_agent.context.append(HumanMessage(content=rag_content))
                # current_agent.context.extend(rag_response)
                continue

            elif user_input.startswith("/game"):

                # 形如指令'/game 1'，将1提取出来
                command = user_input[len("/game") :].strip()
                if not command:
                    logger.error("💡 请输入有效的内容，格式: /game 内容")
                    continue

                # 调用游戏指令处理器
                await handle_game_command(
                    command=command,
                    game_world=game_world,
                    # mcp_client=mcp_client,
                )
                continue

            elif parse_command_with_params(user_input) is not None:
                # 处理参数化 Prompt 调用
                await handle_prompt_with_params_command(user_input, mcp_client)
                continue

            else:
                logger.error("💡 无法识别的输入格式\n")

    except KeyboardInterrupt:
        logger.info("👋 程序已中断。再见！")

    except Exception as e:
        logger.error(f"出现错误: {e}")
        traceback.print_exc()

    finally:
        logger.info("🔒 清理系统资源...")
        if mcp_client:
            await mcp_client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

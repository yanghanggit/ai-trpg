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
from typing import Final, List
import asyncio
from langchain.schema import HumanMessage, SystemMessage
from loguru import logger


from magic_book.deepseek import (
    create_mcp_workflow,
    create_deepseek_llm,
    create_chat_workflow,
    create_rag_workflow,
)

from magic_book.mcp import (
    mcp_config,
)

from magic_book.demo.demo_world import (
    demo_world,
    Actor,
    World,
    Stage,
    gen_world_system_message,
    gen_actor_system_message,
    gen_stage_system_message,
)

from magic_book.utils import parse_command_with_params
from magic_book.rag.game_retriever import GameDocumentRetriever
from magic_book.configuration.game import setup_logger

# 导入本地工具模块
from agent_utils import GameAgent, switch_agent
from mcp_command_handlers import (
    handle_tools_command,
    handle_prompts_command,
    handle_resources_command,
    handle_read_resource_command,
    handle_prompt_with_params_command,
)
from workflow_executors import (
    execute_mcp_state_workflow,
    execute_chat_state_workflow,
    execute_rag_workflow_handler,
)
from io_utils import format_user_input_prompt, log_chat_history
from mcp_client_init import initialize_mcp_client_with_config
from gameplay_handler import handle_game_command


########################################################################################################################
# 创建游戏角色代理
world_agent: Final[GameAgent] = GameAgent(
    name=demo_world.name,
    type=World.__name__,
    chat_history=[SystemMessage(content=gen_world_system_message(demo_world))],
)

# 获取游戏世界中的所有角色
all_actors = demo_world.get_all_actors()
logger.info(f"游戏世界中的所有角色: {[actor.name for actor in all_actors]}")

all_stages = demo_world.get_all_stages()
logger.info(f"游戏世界中的所有场景: {[stage.name for stage in all_stages]}")

# 创建每个角色的代理
actor_agents: List[GameAgent] = []
for actor in all_actors:
    agent = GameAgent(
        name=actor.name,
        type=Actor.__name__,
        chat_history=[
            SystemMessage(content=gen_actor_system_message(actor, demo_world))
        ],
    )
    actor_agents.append(agent)

stage_agents: List[GameAgent] = []
for stage in all_stages:
    agent = GameAgent(
        name=stage.name,
        type=Stage.__name__,
        chat_history=[
            SystemMessage(content=gen_stage_system_message(stage, demo_world))
        ],
    )
    stage_agents.append(agent)


# 所有代理列表
all_agents: List[GameAgent] = [world_agent] + actor_agents + stage_agents

for agent in all_agents:
    logger.info(f"已创建代理: {agent.name}")

    if agent.name == "艾琳":
        logger.debug(f"单独给 [{agent.name}] 添加了狩猎目标提示词")
        agent.chat_history.append(
            HumanMessage(
                content="你当前所处场景：奥顿教堂墓地。你的目标是来狩猎 加斯科因"
            )
        )
    elif agent.name == "加斯科因":
        logger.debug(f"单独给 [{agent.name}] 添加了狩猎目标提示词")
        agent.chat_history.append(
            HumanMessage(
                content="你当前所处场景：奥顿教堂墓地。你的目标是狩猎所有闯入者"
            )
        )
    elif agent.name == "外乡人":
        logger.debug(f"单独给 [{agent.name}] 添加了探索目标提示词")
        agent.chat_history.append(
            HumanMessage(
                content="你当前所处场景：奥顿教堂墓地。你的目标是探索这里的秘密 并 自保"
            )
        )
    elif agent.name == "奥顿教堂墓地":
        logger.debug(f"单独给 [{agent.name}] 添加了场景描述提示词")
        agent.chat_history.append(
            HumanMessage(
                content=""""加斯科因在墓地中央的天使雕像旁来回踱步,手中的猎人斧随着他沉重的步伐不时触碰地面,发出金属摩擦的刺耳声响。他时而仰望血月,时而低头凝视地面,像一头困在笼中的野兽。
艾琳藏身于墓地东侧的阴影之中,乌鸦羽毛斗篷与夜色完全融为一体，无法被其他人察觉。她一动不动地观察着墓地中央的加斯科因。
外乡人刚刚从南侧的铁栅栏门进入墓地,此刻正站在入口处约十米的位置。"""
            )
        )


# 临时测试，添加故事。
# stage1.narrative += """加斯科因在墓地中央的天使雕像旁来回踱步,手中的猎人斧随着他沉重的步伐不时触碰地面,发出金属摩擦的刺耳声响。他时而仰望血月,时而低头凝视地面,像一头困在笼中的野兽。
# 艾琳藏身于墓地东侧的阴影之中,乌鸦羽毛斗篷与夜色完全融为一体，无法被其他人察觉。她一动不动地观察着墓地中央的加斯科因。
# 外乡人刚刚从南侧的铁栅栏门进入墓地,此刻正站在入口处约十米的位置。"""

# ============================================================================
# 主函数
# ============================================================================


async def main() -> None:

    try:

        setup_logger()
        logger.debug("✅ Logger 设置成功")

        # 默认激活的代理是世界观代理
        current_agent: GameAgent = world_agent

        # 创建 DeepSeek LLM 实例
        llm = create_deepseek_llm(0.7)
        logger.debug("✅ DeepSeek LLM 实例创建成功")

        # 创建工作流
        mcp_workflow = create_mcp_workflow()
        logger.debug("✅ MCP 工作流创建成功")

        chat_workflow = create_chat_workflow()
        logger.debug("✅ Chat 工作流创建成功")

        rag_workflow = create_rag_workflow()
        logger.debug("✅ RAG 工作流创建成功")

        game_retriever = GameDocumentRetriever()
        logger.debug("✅ Game 文档检索器创建成功")

        # 初始化 MCP 客户端并获取可用资源
        (
            mcp_client,
            available_tools,
            available_prompts,
            available_resources,
        ) = await initialize_mcp_client_with_config(mcp_config)

        # 对话循环
        while True:

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
                log_chat_history(current_agent.chat_history)
                continue

            # 处理提示词模板命令
            elif user_input.lower() == "/prompts":
                handle_prompts_command(available_prompts)
                continue

            # 处理资源列表命令
            elif user_input.lower() == "/resources":
                handle_resources_command(available_resources)
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

                # 尝试切换代理
                new_agent = switch_agent(all_agents, target_name, current_agent)
                if new_agent is not None:
                    current_agent = new_agent

                continue

            elif user_input.startswith("/mcp"):

                mcp_content = user_input[len("/mcp") :].strip()
                if not mcp_content:
                    logger.error("💡 请输入有效的内容，格式: /mcp 内容")
                    continue

                # 格式化用户输入
                format_user_input = format_user_input_prompt(mcp_content)

                # mcp 的工作流
                response = await execute_mcp_state_workflow(
                    user_input_state={
                        "messages": [HumanMessage(content=format_user_input)],
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
                    work_flow=mcp_workflow,
                )

                # 更新当前代理的对话历史
                current_agent.chat_history.append(
                    HumanMessage(content=format_user_input)
                )
                current_agent.chat_history.extend(response)
                continue

            elif user_input.startswith("/chat"):

                chat_content = user_input[len("/chat") :].strip()
                if not chat_content:
                    logger.error("💡 请输入有效的内容，格式: /chat 内容")
                    continue

                # 格式化用户输入
                format_user_input = format_user_input_prompt(chat_content)

                # 聊天的工作流
                response = execute_chat_state_workflow(
                    user_input_state={
                        "messages": [HumanMessage(content=format_user_input)],
                        "llm": llm,
                    },
                    chat_history_state={
                        "messages": current_agent.chat_history.copy(),
                        "llm": llm,
                    },
                    work_flow=chat_workflow,
                )

                # 更新当前代理的对话历史
                current_agent.chat_history.append(
                    HumanMessage(content=format_user_input)
                )
                current_agent.chat_history.extend(response)
                continue

            elif user_input.startswith("/rag"):

                rag_content = user_input[len("/rag") :].strip()
                if not rag_content:
                    logger.error("💡 请输入有效的内容，格式: /rag 内容")
                    continue

                # RAG 的工作流
                response = execute_rag_workflow_handler(
                    user_input_state={
                        "messages": [HumanMessage(content=rag_content)],
                        "llm": llm,
                        "document_retriever": game_retriever,
                    },
                    chat_history_state={
                        "messages": current_agent.chat_history.copy(),
                        "llm": llm,
                        "document_retriever": game_retriever,
                    },
                    work_flow=rag_workflow,
                )

                # 更新当前代理的对话历史
                current_agent.chat_history.append(HumanMessage(content=rag_content))
                current_agent.chat_history.extend(response)
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
                    current_agent=current_agent,
                    all_agents=all_agents,
                    world_agent=world_agent,
                    stage_agents=stage_agents,
                    actor_agents=actor_agents,
                    llm=llm,
                    mcp_client=mcp_client,
                    available_tools=available_tools,
                    available_prompts=available_prompts,
                    available_resources=available_resources,
                    mcp_workflow=mcp_workflow,
                    chat_workflow=chat_workflow,
                    rag_workflow=rag_workflow,
                    game_retriever=game_retriever,
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

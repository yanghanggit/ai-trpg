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
from langchain.schema import HumanMessage, SystemMessage, AIMessage
from loguru import logger


from ai_trpg.deepseek import (
    create_deepseek_llm,
)

from ai_trpg.mcp import (
    mcp_config,
)

from ai_trpg.demo import (
    GLOBAL_GAME_MECHANICS,
    gen_world_system_message,
    gen_actor_system_message,
    gen_stage_system_message,
    clone_test_world1,
)

from ai_trpg.utils import parse_command_with_params
from ai_trpg.rag.game_retriever import GameDocumentRetriever
from ai_trpg.configuration.game import setup_logger

# 导入本地工具模块
from agent_utils import GameAgent, switch_agent
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
from mcp_client_init import initialize_mcp_client_with_config
from gameplay_handler import handle_game_command

test_world = clone_test_world1()


########################################################################################################################
# 创建游戏角色代理
world_agent: Final[GameAgent] = GameAgent(
    name=test_world.name,
    # type=World.__name__,
    context=[
        SystemMessage(
            content=gen_world_system_message(test_world, GLOBAL_GAME_MECHANICS)
        )
    ],
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
        # type=Actor.__name__,
        context=[
            SystemMessage(
                content=gen_actor_system_message(
                    actor, test_world, GLOBAL_GAME_MECHANICS
                )
            )
        ],
    )
    actor_agents.append(agent)

stage_agents: List[GameAgent] = []
for stage in all_stages:
    agent = GameAgent(
        name=stage.name,
        # type=Stage.__name__,
        context=[
            SystemMessage(
                content=gen_stage_system_message(
                    stage, test_world, GLOBAL_GAME_MECHANICS
                )
            )
        ],
    )
    stage_agents.append(agent)


# 所有代理列表
all_agents: List[GameAgent] = [world_agent] + actor_agents + stage_agents


kickoff_messages = """# 游戏开始！你是谁？你在哪里？你的目标是什么？"""


for agent in all_agents:
    logger.info(f"已创建代理: {agent.name}")

    if agent.name == "艾琳":
        agent.context.extend(
            [
                HumanMessage(content=kickoff_messages),
                AIMessage(
                    content="我是艾琳。我在 奥顿教堂墓地。我的目标是 狩猎 加斯科因！因为斯科因已经兽化，所以必须消灭他。我决定要马上出手一击必杀！"
                ),
            ]
        )

    elif agent.name == "加斯科因":
        agent.context.extend(
            [
                HumanMessage(content=kickoff_messages),
                AIMessage(
                    content="我是加斯科因。我在 奥顿教堂墓地。我的目标是 杀死任何闯入者！毫不犹豫，直接攻击他们。"
                ),
            ]
        )
    elif agent.name == "外乡人":
        agent.context.extend(
            [
                HumanMessage(content=kickoff_messages),
                AIMessage(
                    content="我是外乡人。我在 奥顿教堂墓地。我的目标是 探索这里的秘密并自保，尽量回避危险，必要时可以反击！"
                ),
            ]
        )


# ============================================================================
# 主函数
# ============================================================================


async def main() -> None:

    try:

        setup_logger()
        logger.debug("✅ Logger 设置成功")

        # 默认激活的代理是世界观代理
        current_agent: GameAgent = world_agent

        # 初始化 MCP 客户端并获取可用资源
        mcp_client = await initialize_mcp_client_with_config(mcp_config)
        assert mcp_client is not None, "MCP 客户端初始化失败"

        # 故意读一次，确保世界观资源存在，同时mcp server会重置世界。
        world_resource_uri = f"game://world"
        world_resource_response = await mcp_client.read_resource(world_resource_uri)
        if world_resource_response is None or world_resource_response.text is None:
            raise ValueError(f"❌ 未能读取资源: {world_resource_uri}")

        # logger.debug(
        #     f"🌐 读取世界资源: {world_resource_uri} 成功\n{world_resource_response.text}"
        # )

        # 对话循环
        while True:

            user_input = input(f"[{current_agent.name}]:").strip()

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
                logger.info(f"📜 打印当前代理 [{current_agent.name}] 的对话历史")
                log_history(
                    agent_name=current_agent.name, messages=current_agent.context
                )
                continue

            elif user_input.lower() == "/dump":
                logger.info(f"💾 保存当前代理 [{current_agent.name}] 的对话历史")
                dump_history(
                    agent_name=current_agent.name, messages=current_agent.context
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
                mcp_response = await handle_mcp_workflow_execution(
                    agent_name=current_agent.name,
                    context=current_agent.context.copy(),
                    request=HumanMessage(content=format_user_input),
                    llm=create_deepseek_llm(),
                    mcp_client=mcp_client,
                )

                # 更新当前代理的对话历史
                current_agent.context.append(HumanMessage(content=format_user_input))
                current_agent.context.extend(mcp_response)
                continue

            elif user_input.startswith("/chat"):

                chat_content = user_input[len("/chat") :].strip()
                if not chat_content:
                    logger.error("💡 请输入有效的内容，格式: /chat 内容")
                    continue

                # 格式化用户输入
                format_user_input = format_user_input_prompt(chat_content)

                # 聊天的工作流
                chat_response = await handle_chat_workflow_execution(
                    agent_name=current_agent.name,
                    context=current_agent.context.copy(),
                    request=HumanMessage(content=format_user_input),
                    llm=create_deepseek_llm(),
                )

                # 更新当前代理的对话历史
                current_agent.context.append(HumanMessage(content=format_user_input))
                current_agent.context.extend(chat_response)
                continue

            elif user_input.startswith("/rag"):

                rag_content = user_input[len("/rag") :].strip()
                if not rag_content:
                    logger.error("💡 请输入有效的内容，格式: /rag 内容")
                    continue

                # RAG 的工作流
                rag_response = await handle_rag_workflow_execution(
                    agent_name=current_agent.name,
                    context=current_agent.context.copy(),
                    request=HumanMessage(content=rag_content),
                    llm=create_deepseek_llm(),
                    document_retriever=GameDocumentRetriever(),
                )

                # 更新当前代理的对话历史
                current_agent.context.append(HumanMessage(content=rag_content))
                current_agent.context.extend(rag_response)
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
                    # 游戏上下文
                    current_agent=current_agent,
                    all_agents=all_agents,
                    world_agent=world_agent,
                    stage_agents=stage_agents,
                    actor_agents=actor_agents,
                    # mcp 上下文
                    mcp_client=mcp_client,
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

#!/usr/bin/env python3
"""
游戏流水线 - 开局初始化模块

负责处理游戏场景和角色的开局初始化（Kickoff）流程。
"""

from loguru import logger
from langchain.schema import HumanMessage
from agent_utils import GameAgentManager
from ai_trpg.pgsql import (
    add_stage_context,
    add_actor_context,
    get_world_kickoff,
    set_world_kickoff,
    get_world_stages_and_actors,
)


########################################################################################################################
########################################################################################################################
########################################################################################################################
async def handle_kickoff(
    game_agent_manager: GameAgentManager,
) -> None:
    """处理所有代理的开局初始化

    直接从数据库读取所有 Stage 和 Actor，
    平行地为它们添加 kickoff 消息到上下文中。

    Args:
        game_agent_manager: 游戏代理管理器（仅用于获取 world_name 和 world_id）
        use_concurrency: 是否使用并发处理（保留参数以兼容现有调用）
    """

    # 1. 检查 kickoff 状态
    if get_world_kickoff(game_agent_manager.world_name):
        logger.info("⚠️ 游戏已完成开局初始化，跳过重复执行 kickoff 流程")
        return

    logger.info("🎮 开始开局初始化流程...")

    # 2. 获取 world_id
    world_id = game_agent_manager.world_id
    assert world_id is not None, "无法获取 world_id"

    # 3. 一次性获取所有 Stage 和 Actor
    stages_db, actors_db = get_world_stages_and_actors(world_id)
    assert len(stages_db) > 0, "没有可用的场景，无法进行开局初始化"
    assert len(actors_db) > 0, "没有可用的角色，无法进行开局初始化"
    logger.info(f"📋 获取到 {len(stages_db)} 个场景，{len(actors_db)} 个角色")

    # 4. 平行处理：为所有 Stage 添加 kickoff 消息
    for stage_db in stages_db:
        narrative = stage_db.narrative
        if not narrative:
            logger.warning(f"⚠️ 场景 {stage_db.name} 的 narrative 为空，跳过")
            continue

        # 拼接 kickoff 提示词
        kickoff_prompt = f"""# {stage_db.name}
        
{narrative}"""

        # 添加到场景上下文
        add_stage_context(
            world_id,
            stage_db.name,
            [HumanMessage(content=kickoff_prompt)],
        )
        logger.info(f"✅ 场景 {stage_db.name} kickoff 消息已添加")

    # 5. 平行处理：为所有 Actor 添加 kickoff 消息
    for actor_db in actors_db:
        # 通过 actor_db.stage 关系获取其所属的 StageDB
        stage_db = actor_db.stage
        narrative = stage_db.narrative

        if not narrative:
            logger.warning(
                f"⚠️ 角色 {actor_db.name} 所属场景 {stage_db.name} 的 narrative 为空，跳过"
            )
            continue

        # 拼接相同的 kickoff 提示词
        kickoff_prompt = f"""# {stage_db.name}
        
{narrative}"""

        # 添加到角色上下文
        add_actor_context(
            world_id,
            actor_db.name,
            [HumanMessage(content=kickoff_prompt)],
        )
        logger.info(f"✅ 角色 {actor_db.name} kickoff 消息已添加")

    # 6. 标记整个游戏已完成开局初始化
    set_world_kickoff(game_agent_manager.world_name, True)
    logger.info("✅ 开局初始化流程完成")

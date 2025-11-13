#!/usr/bin/env python3
"""
更新演示世界到数据库

此脚本用于更新数据库中的演示世界数据:
1. 从 demo 模块加载 World 实例
2. 删除数据库中同名的旧世界(如果存在)
3. 保存新的 World 实例到数据库

使用方法:
    python scripts/update_demo_world.py

作者: yanghanggit
日期: 2025-01-13
"""

import os
import sys

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from loguru import logger
from ai_trpg.demo import (
    create_demo_world,
    create_test_world1,
    create_test_world_2_1,
    create_test_world_2_2,
    create_test_world3,
)
from ai_trpg.demo.models import World
from ai_trpg.pgsql.world_operations import (
    save_world_to_db,
    delete_world,
    load_world_from_db,
)


def _update_world_to_db(world: World) -> None:
    """
    更新世界到数据库

    此函数执行以下操作:
    1. 删除数据库中同名的旧世界(如果存在)
    2. 保存新的 World 实例到数据库
    3. 验证保存结果

    Args:
        world: 要更新到数据库的 World 实例

    Raises:
        Exception: 如果更新过程中发生错误
    """
    world_name = world.name

    logger.info(f"✅ 世界信息: {world_name}")
    logger.info(f"   - Stages: {len(world.stages)}")
    for stage in world.stages:
        logger.info(f"     * {stage.name}: {len(stage.actors)} actors")

    # 1. 删除数据库中同名的旧世界(如果存在)
    logger.info(f"🗑️  检查并删除旧世界: {world_name}")
    delete_result = delete_world(world_name)

    if delete_result:
        logger.success(f"✅ 已删除旧世界: {world_name}")
    else:
        logger.info(f"ℹ️  数据库中不存在旧世界: {world_name}")

    # 2. 保存新的 World 实例到数据库
    logger.info(f"💾 保存新世界到数据库: {world_name}")
    world_db = save_world_to_db(world)

    logger.success(f"✅ 世界保存成功!")
    logger.info(f"   - World ID: {world_db.id}")
    logger.info(f"   - World Name: {world_db.name}")
    logger.info(f"   - Campaign Setting: {world_db.campaign_setting}")

    # 3. 验证保存结果
    logger.info("🔍 验证保存结果...")
    loaded_world = load_world_from_db(world_name)

    if loaded_world:
        logger.success(f"✅ 验证成功: 世界可以从数据库正确加载")
        logger.info(f"   - 加载的 Stages: {len(loaded_world.stages)}")
        total_actors = sum(len(stage.actors) for stage in loaded_world.stages)
        logger.info(f"   - 总计 Actors: {total_actors}")
    else:
        logger.error(f"❌ 验证失败: 无法从数据库加载世界")
        raise RuntimeError(f"Failed to verify world {world_name} in database")


# 写一个函数，上述的所有create world全部删除一遍
def _delete_all_demo_worlds() -> None:
    """
    删除所有演示世界

    此函数删除以下演示世界:
    - 雅南城_1 (create_test_world1)
    - 雅南城_2_1 (create_test_world_2_1)
    - 雅南城_2_2 (create_test_world_2_2)
    - 雅南城_3 (create_test_world3)

    Raises:
        Exception: 如果删除过程中发生错误
    """
    # 创建所有演示世界实例并获取它们的名称
    demo_worlds = [
        create_test_world1(),
        create_test_world_2_1(),
        create_test_world_2_2(),
        create_test_world3(),
    ]

    for world in demo_worlds:
        world_name = world.name
        logger.info(f"🗑️  删除演示世界: {world_name}")
        delete_result = delete_world(world_name)

        if delete_result:
            logger.success(f"✅ 已删除演示世界: {world_name}")
        else:
            logger.info(f"ℹ️  数据库中不存在演示世界: {world_name}")


def main() -> None:
    """主函数: 更新演示世界到数据库"""
    try:
        # 0. logger.info("🗑️ 删除所有旧演示世界...")
        _delete_all_demo_worlds()

        logger.info("🚀 开始更新演示世界到数据库...")

        # 1. 创建演示世界实例
        logger.info("📦 创建演示世界实例...")
        demo_world = create_demo_world()

        # 2. 更新世界到数据库
        _update_world_to_db(demo_world)

        logger.success("🎉 演示世界更新完成!")

    except Exception as e:
        logger.error(f"❌ 更新演示世界失败: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

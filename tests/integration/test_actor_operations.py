#!/usr/bin/env python3
"""
Actor Operations 数据库操作集成测试

测试 actor_operations.py 中的功能:
- update_actor_health: 更新角色生命值，生命值为0时自动标记死亡

Author: yanghanggit
Date: 2025-01-13
"""

from typing import Generator
from uuid import UUID
import pytest
from loguru import logger

from src.ai_trpg.demo.world1 import create_test_world1
from src.ai_trpg.pgsql.world_operations import save_world_to_db, delete_world
from src.ai_trpg.pgsql.actor_operations import update_actor_health
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.actor import ActorDB


class TestActorOperations:
    """Actor Operations 数据库操作测试类"""

    # 类变量存储测试 World 信息
    test_world_id: UUID
    test_world_name: str

    @pytest.fixture(scope="class", autouse=True)
    def setup_test_world(self) -> Generator[None, None, None]:
        """为整个测试类设置测试世界(class-scoped)"""
        # 确保表存在
        from src.ai_trpg.pgsql import pgsql_ensure_database_tables

        pgsql_ensure_database_tables()
        logger.info("✅ 数据库表已确保存在")

        # 获取测试世界名称
        test_world_name = create_test_world1().name

        # 测试前：先清理可能存在的同名世界
        try:
            delete_world(test_world_name)
            logger.info(f"🧹 已清理旧的测试世界: {test_world_name}")
        except Exception:
            pass

        # 创建测试世界
        test_world = create_test_world1()
        TestActorOperations.test_world_name = test_world.name
        world_db = save_world_to_db(test_world)
        TestActorOperations.test_world_id = world_db.id
        logger.info(
            f"🌍 测试世界已创建: {TestActorOperations.test_world_name} (ID: {TestActorOperations.test_world_id})"
        )

        yield  # 运行所有测试

        # 测试后：清理
        delete_world(TestActorOperations.test_world_name)
        logger.info(f"🧹 测试完成，已清理世界: {TestActorOperations.test_world_name}")

    @pytest.fixture(autouse=True)
    def reset_actor_state(self) -> None:
        """每个测试方法之间重置角色状态"""
        # 测试前：重置所有角色的生命值和死亡状态
        with SessionLocal() as db:
            actors = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .all()
            )
            for actor in actors:
                actor.attributes.health = actor.attributes.max_health
                actor.is_dead = False
            db.commit()

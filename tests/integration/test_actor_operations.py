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

    def test_update_actor_health_basic(self) -> None:
        """测试基本的生命值更新功能"""
        logger.info("🧪 测试 update_actor_health - 基本更新")

        # 获取测试世界中的第一个角色名称
        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 更新生命值为50
        success = update_actor_health(self.test_world_id, test_actor_name, 50)
        assert success is True

        # 验证数据库中的值已更新
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 50
            assert actor.is_dead is False

        logger.success("✅ 基本生命值更新测试通过")

    def test_update_actor_health_to_zero_marks_dead(self) -> None:
        """测试生命值降为0时自动标记为死亡"""
        logger.info("🧪 测试 update_actor_health - 生命值为0标记死亡")

        # 获取测试角色
        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 更新生命值为0
        success = update_actor_health(self.test_world_id, test_actor_name, 0)
        assert success is True

        # 验证角色被标记为死亡
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 0
            assert actor.is_dead is True

        logger.success("✅ 生命值为0标记死亡测试通过")

    def test_update_actor_health_negative_value(self) -> None:
        """测试负数生命值被自动修正为0"""
        logger.info("🧪 测试 update_actor_health - 负数生命值修正")

        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 尝试设置负数生命值
        success = update_actor_health(self.test_world_id, test_actor_name, -50)
        assert success is True

        # 验证生命值被修正为0，并标记为死亡
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 0  # 负数被修正为0
            assert actor.is_dead is True

        logger.success("✅ 负数生命值修正测试通过")

    def test_update_actor_health_nonexistent_actor(self) -> None:
        """测试更新不存在的角色"""
        logger.info("🧪 测试 update_actor_health - 不存在的角色")

        # 尝试更新不存在的角色
        success = update_actor_health(self.test_world_id, "不存在的角色", 100)
        assert success is False

        logger.success("✅ 不存在角色测试通过")

    def test_update_actor_health_multiple_times(self) -> None:
        """测试多次更新同一角色的生命值"""
        logger.info("🧪 测试 update_actor_health - 多次更新")

        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 第一次更新：降低生命值
        success1 = update_actor_health(self.test_world_id, test_actor_name, 80)
        assert success1 is True

        # 第二次更新：继续降低
        success2 = update_actor_health(self.test_world_id, test_actor_name, 30)
        assert success2 is True

        # 第三次更新：恢复一些生命值
        success3 = update_actor_health(self.test_world_id, test_actor_name, 60)
        assert success3 is True

        # 验证最终值
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 60
            assert actor.is_dead is False

        logger.success("✅ 多次更新测试通过")

    def test_update_actor_health_max_health_boundary(self) -> None:
        """测试生命值超过最大值的情况"""
        logger.info("🧪 测试 update_actor_health - 超过最大生命值")

        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 获取最大生命值
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            max_health = actor.attributes.max_health

        # 设置超过最大生命值的值
        over_max_value = max_health + 50
        success = update_actor_health(
            self.test_world_id, test_actor_name, over_max_value
        )
        assert success is True

        # 验证可以设置超过最大值（游戏逻辑允许）
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == over_max_value
            assert actor.is_dead is False

        logger.success("✅ 超过最大生命值测试通过")

    def test_update_actor_health_all_actors_in_stage(self) -> None:
        """测试更新场景中所有角色的生命值"""
        logger.info("🧪 测试 update_actor_health - 更新场景中所有角色")

        test_world = create_test_world1()
        test_stage = test_world.stages[0]

        # 更新该场景中所有角色的生命值
        for actor in test_stage.actors:
            success = update_actor_health(self.test_world_id, actor.name, 25)
            assert success is True

        # 验证所有角色都已更新
        with SessionLocal() as db:
            for actor in test_stage.actors:
                db_actor = (
                    db.query(ActorDB)
                    .join(ActorDB.stage)
                    .filter(ActorDB.name == actor.name)
                    .filter(ActorDB.stage.has(world_id=self.test_world_id))
                    .first()
                )
                assert db_actor is not None
                assert db_actor.attributes.health == 25
                assert db_actor.is_dead is False

        logger.success("✅ 更新场景中所有角色测试通过")

    def test_update_actor_health_resurrection_scenario(self) -> None:
        """测试'复活'场景：从死亡状态恢复生命值"""
        logger.info("🧪 测试 update_actor_health - 复活场景")

        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 先让角色死亡
        success1 = update_actor_health(self.test_world_id, test_actor_name, 0)
        assert success1 is True

        # 验证已死亡
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.is_dead is True

        # 恢复生命值（但 is_dead 不会自动变回 False）
        success2 = update_actor_health(self.test_world_id, test_actor_name, 50)
        assert success2 is True

        # 验证生命值恢复了，但仍然标记为死亡（需要其他逻辑处理复活）
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 50
            assert actor.is_dead is True  # 仍然标记为死亡

        logger.success("✅ 复活场景测试通过")

    def test_update_actor_health_zero_boundary(self) -> None:
        """测试生命值恰好为0的边界情况"""
        logger.info("🧪 测试 update_actor_health - 零值边界")

        test_world = create_test_world1()
        test_actor_name = test_world.stages[0].actors[0].name

        # 先设置为1
        update_actor_health(self.test_world_id, test_actor_name, 1)

        # 再设置为0
        success = update_actor_health(self.test_world_id, test_actor_name, 0)
        assert success is True

        # 验证
        with SessionLocal() as db:
            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None
            assert actor.attributes.health == 0
            assert actor.is_dead is True

        logger.success("✅ 零值边界测试通过")

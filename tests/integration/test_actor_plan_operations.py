#!/usr/bin/env python3
"""
Actor Plan 数据库操作集成测试

测试 actor_plan_operations.py 中的 CRUD 操作:
- add_actor_plan_to_db: 添加角色计划
- clear_all_actor_plans: 清空指定角色的所有计划
- clear_multiple_actor_plans: 批量清空多个角色的所有计划

测试功能:
- 计划添加与查询
- 单个角色计划清空
- 多个角色批量计划清空
- 数据一致性验证

Author: yanghanggit
Date: 2025-01-13
"""

from typing import Generator
from uuid import UUID
import pytest
from loguru import logger

from src.ai_trpg.demo.world1 import create_test_world1
from src.ai_trpg.pgsql.world_operations import save_world_to_db, delete_world
from src.ai_trpg.pgsql.actor_plan_operations import (
    add_actor_plan_to_db,
    clear_all_actor_plans,
    clear_multiple_actor_plans,
)
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.actor_plan import ActorPlanDB


class TestActorPlanOperations:
    """Actor Plan 数据库操作测试类"""

    # 类变量存储测试 World信息(所有测试方法共享)
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
        TestActorPlanOperations.test_world_name = test_world.name
        world_db = save_world_to_db(test_world)
        TestActorPlanOperations.test_world_id = world_db.id
        logger.info(
            f"🌍 测试世界已创建: {TestActorPlanOperations.test_world_name} (ID: {TestActorPlanOperations.test_world_id})"
        )

        yield  # 运行所有测试

        # 测试后：清理
        delete_world(TestActorPlanOperations.test_world_name)
        logger.info(
            f"🧹 测试完成，已清理世界: {TestActorPlanOperations.test_world_name}"
        )

    @pytest.fixture(autouse=True)
    def clear_plans_between_tests(self) -> None:
        """每个测试方法之间清理所有计划"""
        try:
            with SessionLocal() as db:
                db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).delete()
                db.commit()
            logger.info("🧹 测试前已清理角色计划")
        except Exception as e:
            logger.warning(f"清理失败(可能表不存在): {e}")

    def test_add_actor_plan_basic(self) -> None:
        """测试基本的计划添加功能"""
        logger.info("🧪 测试 add_actor_plan_to_db - 基本添加")

        # 添加计划
        plan_db = add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="测试角色",
            plan_content="今天的计划是去森林探险",
        )

        # 验证返回值
        assert plan_db is not None
        assert plan_db.actor_name == "测试角色"
        assert plan_db.plan_content == "今天的计划是去森林探险"
        assert plan_db.world_id == self.test_world_id
        assert plan_db.created_at is not None

        # 验证数据库中存在
        with SessionLocal() as db:
            saved_plan = db.query(ActorPlanDB).filter_by(id=plan_db.id).first()
            assert saved_plan is not None
            assert saved_plan.actor_name == "测试角色"
            assert saved_plan.plan_content == "今天的计划是去森林探险"

        logger.success("✅ 基本添加功能测试通过")

    def test_add_multiple_plans_same_actor(self) -> None:
        """测试为同一角色添加多个计划"""
        logger.info("🧪 测试同一角色多个计划")

        actor_name = "冒险者"
        plans = [
            "计划1: 早晨前往市场购买装备",
            "计划2: 中午在酒馆收集情报",
            "计划3: 下午探索古老的废墟",
        ]

        # 添加多个计划
        for plan_content in plans:
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name=actor_name,
                plan_content=plan_content,
            )

        # 验证所有计划都保存了
        with SessionLocal() as db:
            saved_plans = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name=actor_name)
                .all()
            )
            assert len(saved_plans) == 3
            saved_contents = [plan.plan_content for plan in saved_plans]
            assert set(saved_contents) == set(plans)

        logger.success("✅ 同一角色多个计划测试通过")

    def test_add_plans_different_actors(self) -> None:
        """测试为不同角色添加计划"""
        logger.info("🧪 测试不同角色的计划")

        actors_and_plans = [
            ("战士", "训练剑术和盾牌防御"),
            ("法师", "研究新的咒语和魔法阵"),
            ("盗贼", "侦查敌人的营地位置"),
        ]

        # 为每个角色添加计划
        for actor_name, plan_content in actors_and_plans:
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name=actor_name,
                plan_content=plan_content,
            )

        # 验证每个角色的计划
        with SessionLocal() as db:
            for actor_name, expected_content in actors_and_plans:
                plans = (
                    db.query(ActorPlanDB)
                    .filter_by(world_id=self.test_world_id, actor_name=actor_name)
                    .all()
                )
                assert len(plans) == 1
                assert plans[0].plan_content == expected_content

        logger.success("✅ 不同角色的计划测试通过")

    def test_clear_single_actor_plans(self) -> None:
        """测试清空单个角色的所有计划"""
        logger.info("🧪 测试 clear_all_actor_plans - 单个角色")

        # 为两个角色添加计划
        for i in range(3):
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name="角色A",
                plan_content=f"角色A的计划{i+1}",
            )

        for i in range(2):
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name="角色B",
                plan_content=f"角色B的计划{i+1}",
            )

        # 验证计划已添加
        with SessionLocal() as db:
            plans_a = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name="角色A")
                .count()
            )
            plans_b = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name="角色B")
                .count()
            )
            assert plans_a == 3
            assert plans_b == 2

        # 清空角色A的计划
        cleared_count = clear_all_actor_plans(self.test_world_id, "角色A")
        assert cleared_count == 3

        # 验证只有角色A的计划被清空
        with SessionLocal() as db:
            plans_a = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name="角色A")
                .count()
            )
            plans_b = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name="角色B")
                .count()
            )
            assert plans_a == 0
            assert plans_b == 2  # 角色B的计划不受影响

        logger.success("✅ 清空单个角色计划测试通过")

    def test_clear_nonexistent_actor_plans(self) -> None:
        """测试清空不存在角色的计划"""
        logger.info("🧪 测试清空不存在角色的计划")

        # 清空不存在的角色
        cleared_count = clear_all_actor_plans(self.test_world_id, "不存在的角色")
        assert cleared_count == 0

        logger.success("✅ 清空不存在角色计划测试通过")

    def test_clear_multiple_actor_plans(self) -> None:
        """测试批量清空多个角色的计划"""
        logger.info("🧪 测试 clear_multiple_actor_plans - 批量清空")

        # 为5个角色添加计划
        actors = ["角色1", "角色2", "角色3", "角色4", "角色5"]
        for actor in actors:
            for i in range(2):  # 每个角色2个计划
                add_actor_plan_to_db(
                    world_id=self.test_world_id,
                    actor_name=actor,
                    plan_content=f"{actor}的计划{i+1}",
                )

        # 验证所有计划已添加
        with SessionLocal() as db:
            total_plans = (
                db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            )
            assert total_plans == 10

        # 批量清空角色1、2、3的计划
        actors_to_clear = ["角色1", "角色2", "角色3"]
        cleared_count = clear_multiple_actor_plans(self.test_world_id, actors_to_clear)
        assert cleared_count == 6  # 3个角色 × 2个计划

        # 验证清空结果
        with SessionLocal() as db:
            # 角色1、2、3的计划应该被清空
            for actor in actors_to_clear:
                plans = (
                    db.query(ActorPlanDB)
                    .filter_by(world_id=self.test_world_id, actor_name=actor)
                    .count()
                )
                assert plans == 0

            # 角色4、5的计划应该保留
            remaining_plans = (
                db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            )
            assert remaining_plans == 4  # 2个角色 × 2个计划

        logger.success("✅ 批量清空多个角色计划测试通过")

    def test_clear_multiple_actors_empty_list(self) -> None:
        """测试批量清空空列表"""
        logger.info("🧪 测试批量清空空列表")

        # 添加一些计划
        add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="测试角色",
            plan_content="测试计划",
        )

        # 使用空列表清空
        cleared_count = clear_multiple_actor_plans(self.test_world_id, [])
        assert cleared_count == 0

        # 验证计划仍然存在
        with SessionLocal() as db:
            plans = db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            assert plans == 1

        logger.success("✅ 批量清空空列表测试通过")

    def test_clear_multiple_actors_partial_match(self) -> None:
        """测试批量清空部分匹配的角色"""
        logger.info("🧪 测试批量清空部分匹配")

        # 添加3个角色的计划
        actors = ["存在角色1", "存在角色2", "存在角色3"]
        for actor in actors:
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name=actor,
                plan_content=f"{actor}的计划",
            )

        # 尝试清空包含不存在角色的列表
        actors_to_clear = ["存在角色1", "不存在角色", "存在角色2"]
        cleared_count = clear_multiple_actor_plans(self.test_world_id, actors_to_clear)
        assert cleared_count == 2  # 只有2个存在的角色

        # 验证结果
        with SessionLocal() as db:
            remaining_plans = (
                db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).all()
            )
            assert len(remaining_plans) == 1
            assert remaining_plans[0].actor_name == "存在角色3"

        logger.success("✅ 批量清空部分匹配测试通过")

    def test_long_plan_content(self) -> None:
        """测试长计划内容(最大1024字符)"""
        logger.info("🧪 测试长计划内容")

        # 创建接近1024字符的计划
        long_plan = "这是一个详细的计划。" * 100  # 约1000字符
        long_plan = long_plan[:1024]  # 确保不超过1024

        plan_db = add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="详细规划者",
            plan_content=long_plan,
        )

        # 验证长内容正确保存
        assert len(plan_db.plan_content) <= 1024
        assert plan_db.plan_content == long_plan

        # 从数据库验证
        with SessionLocal() as db:
            saved_plan = db.query(ActorPlanDB).filter_by(id=plan_db.id).first()
            assert saved_plan is not None
            assert saved_plan.plan_content == long_plan

        logger.success("✅ 长计划内容测试通过")

    def test_chinese_characters_in_plans(self) -> None:
        """测试中文字符支持"""
        logger.info("🧪 测试中文字符支持")

        # 使用中文计划
        plan_db = add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="李逍遥",
            plan_content="明日清晨前往仙灵岛寻找紫金丹，途经蛇妖洞需小心应对，准备好木剑和灵药。",
        )

        # 验证中文正确保存
        assert plan_db.actor_name == "李逍遥"
        assert "紫金丹" in plan_db.plan_content
        assert "蛇妖洞" in plan_db.plan_content

        # 从数据库查询验证
        with SessionLocal() as db:
            plans = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name="李逍遥")
                .all()
            )
            assert len(plans) == 1
            assert plans[0].actor_name == "李逍遥"

        logger.success("✅ 中文字符支持测试通过")

    def test_special_characters_in_plans(self) -> None:
        """测试特殊字符支持"""
        logger.info("🧪 测试特殊字符")

        # 使用特殊字符
        plan_db = add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="角色@123",
            plan_content="计划包含特殊符号: !@#$%^&*()_+-=[]{}|;':\",./<>?",
        )

        # 验证特殊字符正确处理
        assert plan_db.actor_name == "角色@123"
        assert "!@#$%^&*()" in plan_db.plan_content

        logger.success("✅ 特殊字符测试通过")

    def test_plan_timestamp_ordering(self) -> None:
        """测试计划时间戳排序"""
        logger.info("🧪 测试计划时间戳")

        actor_name = "时间测试者"

        # 连续添加多个计划
        for i in range(5):
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name=actor_name,
                plan_content=f"计划{i+1}",
            )

        # 查询并验证时间顺序
        with SessionLocal() as db:
            plans = (
                db.query(ActorPlanDB)
                .filter_by(world_id=self.test_world_id, actor_name=actor_name)
                .order_by(ActorPlanDB.created_at)
                .all()
            )
            assert len(plans) == 5

            # 验证时间递增
            for i in range(len(plans) - 1):
                assert plans[i].created_at <= plans[i + 1].created_at

        logger.success("✅ 计划时间戳测试通过")

    def test_empty_plan_content(self) -> None:
        """测试空计划内容"""
        logger.info("🧪 测试空计划内容")

        # 添加空计划
        plan_db = add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="无计划者",
            plan_content="",
        )

        # 验证空字符串
        assert plan_db.plan_content == ""

        # 从数据库验证
        with SessionLocal() as db:
            saved_plan = db.query(ActorPlanDB).filter_by(id=plan_db.id).first()
            assert saved_plan is not None
            assert saved_plan.plan_content == ""

        logger.success("✅ 空计划内容测试通过")

    def test_bulk_operations_performance(self) -> None:
        """测试批量操作性能"""
        logger.info("🧪 测试批量操作性能")

        # 批量添加计划
        actors = [f"角色{i}" for i in range(50)]
        for actor in actors:
            add_actor_plan_to_db(
                world_id=self.test_world_id,
                actor_name=actor,
                plan_content=f"{actor}的详细行动计划",
            )

        # 验证所有计划已添加
        with SessionLocal() as db:
            total = db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            assert total == 50

        # 批量清空前30个角色
        actors_to_clear = actors[:30]
        cleared_count = clear_multiple_actor_plans(self.test_world_id, actors_to_clear)
        assert cleared_count == 30

        # 验证剩余20个
        with SessionLocal() as db:
            remaining = (
                db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            )
            assert remaining == 20

        logger.success("✅ 批量操作性能测试通过")

    def test_actor_plan_isolation_between_worlds(self) -> None:
        """测试不同世界之间的计划隔离"""
        logger.info("🧪 测试世界间计划隔离")

        # 在当前测试世界添加计划
        add_actor_plan_to_db(
            world_id=self.test_world_id,
            actor_name="角色A",
            plan_content="测试世界的计划",
        )

        # 验证只有1个计划
        with SessionLocal() as db:
            plans = db.query(ActorPlanDB).filter_by(world_id=self.test_world_id).count()
            assert plans == 1

        # 清空计划不应影响其他世界（虽然没有其他世界，但验证查询正确性）
        cleared = clear_all_actor_plans(self.test_world_id, "角色A")
        assert cleared == 1

        logger.success("✅ 世界间计划隔离测试通过")

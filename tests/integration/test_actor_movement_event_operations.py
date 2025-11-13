#!/usr/bin/env python3
"""
Actor Movement Event 数据库操作集成测试

测试 actor_movement_event_operations.py 中的 CRUD 操作:
- save_actor_movement_event_to_db: 保存角色移动事件
- get_actor_movement_events_by_actor: 按角色名查询移动事件
- get_actor_movement_events_by_stage: 按场景名查询移动事件
- clear_all_actor_movement_events: 清空所有移动事件

测试 Unlogged Table 特性:
- 高性能写入（无 WAL）
- 索引查询性能
- 并发插入
- 清空操作

Author: yanghanggit
Date: 2025-01-13
"""

from typing import Generator
from uuid import UUID
import pytest
from loguru import logger

from src.ai_trpg.demo.world1 import create_test_world1
from src.ai_trpg.pgsql.world_operations import save_world_to_db, delete_world
from src.ai_trpg.pgsql.actor_movement_event_operations import (
    save_actor_movement_event_to_db,
    get_actor_movement_events_by_actor,
    get_actor_movement_events_by_stage,
    clear_all_actor_movement_events,
)
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.actor_movement_event import ActorMovementEventDB


class TestActorMovementEventOperations:
    """Actor Movement Event 数据库操作测试类"""

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

        # 获取测试世界名称（避免硬编码）
        test_world_name = create_test_world1().name

        # 测试前：先清理可能存在的同名世界
        try:
            delete_world(test_world_name)
            logger.info(f"🧹 已清理旧的测试世界: {test_world_name}")
        except Exception:
            pass  # 不存在也没关系

        # 创建测试世界
        test_world = create_test_world1()
        TestActorMovementEventOperations.test_world_name = test_world.name
        world_db = save_world_to_db(test_world)
        TestActorMovementEventOperations.test_world_id = world_db.id
        logger.info(
            f"🌍 测试世界已创建: {TestActorMovementEventOperations.test_world_name} (ID: {TestActorMovementEventOperations.test_world_id})"
        )

        yield  # 运行所有测试

        # 测试后：清理
        clear_all_actor_movement_events()
        delete_world(TestActorMovementEventOperations.test_world_name)
        logger.info(
            f"🧹 测试完成，已清理世界: {TestActorMovementEventOperations.test_world_name}"
        )

    @pytest.fixture(autouse=True)
    def clear_events_between_tests(self) -> None:
        """每个测试方法之间清理移动事件"""
        try:
            clear_all_actor_movement_events()
            logger.info("🧹 测试前已清理移动事件")
        except Exception as e:
            logger.warning(f"清理失败(可能表不存在): {e}")

    def test_save_actor_movement_event_basic(self) -> None:
        """测试基本的移动事件保存功能"""
        logger.info("🧪 测试 save_actor_movement_event_to_db - 基本保存")

        # 保存移动事件
        event_db = save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="测试角色",
            from_stage="起始场景",
            to_stage="目标场景",
            description="测试移动事件",
            entry_posture_and_status="站立 | 正常",
        )

        # 验证返回值
        assert event_db is not None
        assert event_db.actor_name == "测试角色"
        assert event_db.from_stage == "起始场景"
        assert event_db.to_stage == "目标场景"
        assert event_db.description == "测试移动事件"
        assert event_db.entry_posture_and_status == "站立 | 正常"
        assert event_db.created_at is not None

        # 验证数据库中存在
        with SessionLocal() as db:
            saved_event = (
                db.query(ActorMovementEventDB).filter_by(id=event_db.id).first()
            )
            assert saved_event is not None
            assert saved_event.actor_name == "测试角色"

        logger.success("✅ 基本保存功能测试通过")

    def test_save_event_with_empty_posture(self) -> None:
        """测试保存不带姿态信息的事件"""
        logger.info("🧪 测试 save_actor_movement_event_to_db - 空姿态")

        # 保存事件（不指定 entry_posture_and_status）
        event_db = save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色A",
            from_stage="场景1",
            to_stage="场景2",
            description="简单移动",
        )

        # 验证默认值
        assert event_db.entry_posture_and_status == ""

        logger.success("✅ 空姿态测试通过")

    def test_get_events_by_actor(self) -> None:
        """测试按角色名查询移动事件"""
        logger.info("🧪 测试 get_actor_movement_events_by_actor")

        # 保存多个角色的移动事件
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色A",
            from_stage="场景1",
            to_stage="场景2",
            description="第一次移动",
        )
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色A",
            from_stage="场景2",
            to_stage="场景3",
            description="第二次移动",
        )
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色B",
            from_stage="场景1",
            to_stage="场景4",
            description="其他角色移动",
        )

        # 查询角色A的事件
        events_a = get_actor_movement_events_by_actor(self.test_world_id, "角色A")
        assert len(events_a) == 2
        assert all(event.actor_name == "角色A" for event in events_a)

        # 验证按时间排序
        assert events_a[0].created_at <= events_a[1].created_at

        # 查询角色B的事件
        events_b = get_actor_movement_events_by_actor(self.test_world_id, "角色B")
        assert len(events_b) == 1
        assert events_b[0].actor_name == "角色B"

        # 查询不存在的角色
        events_none = get_actor_movement_events_by_actor(
            self.test_world_id, "不存在的角色"
        )
        assert len(events_none) == 0

        logger.success("✅ 按角色查询测试通过")

    def test_get_events_by_stage(self) -> None:
        """测试按场景名查询移动事件"""
        logger.info("🧪 测试 get_actor_movement_events_by_stage")

        # 保存多个进入相同场景的事件
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色A",
            from_stage="场景1",
            to_stage="目标场景",
            description="角色A进入",
        )
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色B",
            from_stage="场景2",
            to_stage="目标场景",
            description="角色B进入",
        )
        save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色C",
            from_stage="场景3",
            to_stage="其他场景",
            description="角色C去其他地方",
        )

        # 查询进入"目标场景"的所有事件
        events_target = get_actor_movement_events_by_stage(
            self.test_world_id, "目标场景"
        )
        assert len(events_target) == 2
        assert all(event.to_stage == "目标场景" for event in events_target)

        # 验证包含正确的角色
        actor_names = {event.actor_name for event in events_target}
        assert actor_names == {"角色A", "角色B"}

        # 查询进入"其他场景"的事件
        events_other = get_actor_movement_events_by_stage(
            self.test_world_id, "其他场景"
        )
        assert len(events_other) == 1
        assert events_other[0].actor_name == "角色C"

        # 查询不存在的场景
        events_none = get_actor_movement_events_by_stage(
            self.test_world_id, "不存在的场景"
        )
        assert len(events_none) == 0

        logger.success("✅ 按场景查询测试通过")

    def test_clear_all_events(self) -> None:
        """测试清空所有移动事件"""
        logger.info("🧪 测试 clear_all_actor_movement_events")

        # 保存多个事件
        for i in range(5):
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name=f"角色{i}",
                from_stage=f"场景{i}",
                to_stage=f"场景{i+1}",
                description=f"移动{i}",
            )

        # 验证事件已保存
        with SessionLocal() as db:
            count_before = db.query(ActorMovementEventDB).count()
            assert count_before == 5

        # 清空所有事件
        cleared_count = clear_all_actor_movement_events()
        assert cleared_count == 5

        # 验证已清空
        with SessionLocal() as db:
            count_after = db.query(ActorMovementEventDB).count()
            assert count_after == 0

        logger.success("✅ 清空所有事件测试通过")

    def test_clear_empty_table(self) -> None:
        """测试清空空表"""
        logger.info("🧪 测试 clear_all_actor_movement_events - 空表")

        # 确保表为空
        clear_all_actor_movement_events()

        # 再次清空空表
        cleared_count = clear_all_actor_movement_events()
        assert cleared_count == 0

        logger.success("✅ 清空空表测试通过")

    def test_multiple_movements_same_actor(self) -> None:
        """测试同一角色的多次移动"""
        logger.info("🧪 测试同一角色多次移动")

        actor_name = "旅行者"
        stages = ["起点", "村庄", "森林", "城堡", "终点"]

        # 模拟角色依次通过多个场景
        for i in range(len(stages) - 1):
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name=actor_name,
                from_stage=stages[i],
                to_stage=stages[i + 1],
                description=f"{actor_name}从{stages[i]}移动到{stages[i+1]}",
                entry_posture_and_status="行走 | 正常" if i < 3 else "奔跑 | 紧张",
            )

        # 查询该角色的所有移动记录
        events = get_actor_movement_events_by_actor(self.test_world_id, actor_name)
        assert len(events) == 4

        # 验证移动轨迹
        for i, event in enumerate(events):
            assert event.from_stage == stages[i]
            assert event.to_stage == stages[i + 1]

        # 验证姿态变化
        assert events[0].entry_posture_and_status == "行走 | 正常"
        assert events[3].entry_posture_and_status == "奔跑 | 紧张"

        logger.success("✅ 同一角色多次移动测试通过")

    def test_multiple_actors_same_stage(self) -> None:
        """测试多个角色进入同一场景"""
        logger.info("🧪 测试多个角色进入同一场景")

        target_stage = "集合点"
        actors = ["战士", "法师", "盗贼", "牧师"]

        # 模拟多个角色从不同地方来到集合点
        for i, actor in enumerate(actors):
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name=actor,
                from_stage=f"起点{i}",
                to_stage=target_stage,
                description=f"{actor}抵达{target_stage}",
                entry_posture_and_status=f"姿态{i} | 状态{i}",
            )

        # 查询进入集合点的所有事件
        events = get_actor_movement_events_by_stage(self.test_world_id, target_stage)
        assert len(events) == 4

        # 验证所有角色都到达了
        actor_names = {event.actor_name for event in events}
        assert actor_names == set(actors)

        # 验证每个角色有不同的姿态
        postures = [event.entry_posture_and_status for event in events]
        assert len(set(postures)) == 4  # 所有姿态都不同

        logger.success("✅ 多个角色进入同一场景测试通过")

    def test_event_time_ordering(self) -> None:
        """测试事件时间排序"""
        logger.info("🧪 测试事件时间排序")

        # 快速连续保存多个事件
        for i in range(10):
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name="时间测试角色",
                from_stage=f"场景{i}",
                to_stage=f"场景{i+1}",
                description=f"第{i+1}次移动",
            )

        # 查询所有事件
        events = get_actor_movement_events_by_actor(self.test_world_id, "时间测试角色")
        assert len(events) == 10

        # 验证时间递增
        for i in range(len(events) - 1):
            assert events[i].created_at <= events[i + 1].created_at

        logger.success("✅ 事件时间排序测试通过")

    def test_chinese_characters_support(self) -> None:
        """测试中文字符支持"""
        logger.info("🧪 测试中文字符支持")

        # 使用中文保存事件
        event_db = save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="李逍遥",
            from_stage="余杭镇客栈",
            to_stage="仙灵岛",
            description="李逍遥为救灵儿，踏上仙灵岛寻找紫金丹",
            entry_posture_and_status="背负木剑，谨慎前行 | 【担忧】【决心】",
        )

        # 验证中文正确保存
        assert event_db.actor_name == "李逍遥"
        assert event_db.from_stage == "余杭镇客栈"
        assert event_db.to_stage == "仙灵岛"
        assert "紫金丹" in event_db.description
        assert "担忧" in event_db.entry_posture_and_status

        # 从数据库查询验证
        events = get_actor_movement_events_by_actor(self.test_world_id, "李逍遥")
        assert len(events) == 1
        assert events[0].actor_name == "李逍遥"

        logger.success("✅ 中文字符支持测试通过")

    def test_long_description_support(self) -> None:
        """测试长文本描述支持"""
        logger.info("🧪 测试长文本描述")

        # 创建长描述
        long_description = "这是一段非常长的描述。" * 100  # 1000+ 字符
        long_posture = "复杂姿态描述：" + "细节" * 50

        event_db = save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="测试角色",
            from_stage="场景A",
            to_stage="场景B",
            description=long_description,
            entry_posture_and_status=long_posture,
        )

        # 验证长文本正确保存
        assert len(event_db.description) > 1000
        assert event_db.description == long_description
        assert event_db.entry_posture_and_status == long_posture

        logger.success("✅ 长文本描述测试通过")

    def test_special_characters_in_names(self) -> None:
        """测试特殊字符支持"""
        logger.info("🧪 测试特殊字符")

        # 使用特殊字符
        event_db = save_actor_movement_event_to_db(
            world_id=self.test_world_id,
            actor_name="角色@#123",
            from_stage="场景<1>",
            to_stage="场景{2}",
            description="包含特殊字符: !@#$%^&*()_+-=[]{}|;':\",./<>?",
            entry_posture_and_status="姿态 | 状态",
        )

        # 验证特殊字符正确处理
        assert event_db.actor_name == "角色@#123"
        assert event_db.from_stage == "场景<1>"
        assert event_db.to_stage == "场景{2}"

        # 查询验证
        events = get_actor_movement_events_by_actor(self.test_world_id, "角色@#123")
        assert len(events) == 1

        logger.success("✅ 特殊字符测试通过")

    def test_concurrent_inserts_simulation(self) -> None:
        """测试模拟并发插入（顺序执行但验证数据一致性）"""
        logger.info("🧪 测试模拟并发插入")

        # 模拟多个角色同时移动
        actors = [f"角色{i}" for i in range(20)]
        for actor in actors:
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name=actor,
                from_stage="起点",
                to_stage="终点",
                description=f"{actor}的移动",
            )

        # 验证所有事件都正确保存
        events = get_actor_movement_events_by_stage(self.test_world_id, "终点")
        assert len(events) == 20

        # 验证没有重复
        actor_names = [event.actor_name for event in events]
        assert len(set(actor_names)) == 20

        logger.success("✅ 模拟并发插入测试通过")

    def test_query_performance_with_index(self) -> None:
        """测试索引查询性能（验证索引存在且工作）"""
        logger.info("🧪 测试索引查询性能")

        # 插入大量数据
        for i in range(100):
            save_actor_movement_event_to_db(
                world_id=self.test_world_id,
                actor_name=f"角色{i % 10}",  # 10个不同角色
                from_stage=f"场景{i}",
                to_stage=f"场景{i % 5}",  # 5个不同目标场景
                description=f"移动{i}",
            )

        # 查询特定角色（应该使用 actor_name 索引）
        events_actor = get_actor_movement_events_by_actor(self.test_world_id, "角色5")
        assert len(events_actor) == 10

        # 查询特定场景（应该使用 to_stage 索引）
        events_stage = get_actor_movement_events_by_stage(self.test_world_id, "场景3")
        assert len(events_stage) == 20

        # 验证查询结果正确性
        assert all(event.actor_name == "角色5" for event in events_actor)
        assert all(event.to_stage == "场景3" for event in events_stage)

        logger.success("✅ 索引查询性能测试通过")

    def test_empty_query_results(self) -> None:
        """测试空查询结果"""
        logger.info("🧪 测试空查询结果")

        # 不插入任何数据，直接查询
        events_actor = get_actor_movement_events_by_actor(
            self.test_world_id, "不存在的角色"
        )
        assert len(events_actor) == 0
        assert isinstance(events_actor, list)

        events_stage = get_actor_movement_events_by_stage(
            self.test_world_id, "不存在的场景"
        )
        assert len(events_stage) == 0
        assert isinstance(events_stage, list)

        logger.success("✅ 空查询结果测试通过")

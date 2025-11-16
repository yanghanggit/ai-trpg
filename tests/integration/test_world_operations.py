#!/usr/bin/env python3
"""
World 数据库操作集成测试

测试 world_operations.py 中的 save_world_to_db, load_world_from_db, delete_world 功能
包括：
- World 保存测试（递归保存 Stages/Actors/Attributes/Effects/Messages）
- World 加载测试（递归加载并转换为 Pydantic 模型）
- World 删除测试（CASCADE 删除验证）
- 数据完整性测试（保存后加载验证数据一致性）
- BaseMessage 序列化/反序列化测试

Author: yanghanggit
Date: 2025-01-13
"""

from typing import Generator
import pytest
from loguru import logger

from src.ai_trpg.demo.world1 import create_test_world1
from src.ai_trpg.demo.world2 import create_test_world_2_1, create_test_world_2_2
from src.ai_trpg.demo.world3 import create_test_world3
from src.ai_trpg.pgsql.world_operations import (
    save_world_to_db,
    delete_world,
)
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.world import WorldDB
from src.ai_trpg.pgsql.stage import StageDB
from src.ai_trpg.pgsql.actor import ActorDB
from src.ai_trpg.pgsql.attributes import AttributesDB
from src.ai_trpg.pgsql.effect import EffectDB
from src.ai_trpg.pgsql.message import MessageDB


class TestWorldOperations:
    """World 数据库操作测试类"""

    @pytest.fixture(autouse=True)
    def cleanup_test_worlds(self) -> Generator[None, None, None]:
        """测试前后自动清理测试世界"""
        # 创建所有测试世界实例并获取它们的名称
        test_worlds = [
            create_test_world1(),
            create_test_world_2_1(),
            create_test_world_2_2(),
            create_test_world3(),
        ]
        test_world_names = [world.name for world in test_worlds]

        # 测试前清理
        for world_name in test_world_names:
            self._cleanup_test_world(world_name)

        yield  # 运行测试

        # 测试后清理
        for world_name in test_world_names:
            self._cleanup_test_world(world_name)

    def test_save_world_to_db_basic(self) -> None:
        """测试基本的 World 保存功能"""
        logger.info("🧪 测试 save_world_to_db - 基本保存功能")

        # 创建测试世界
        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)

            # 验证保存结果
            assert world_db is not None
            assert world_db.name == world_name

            # 验证数据库中确实存在
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert saved_world is not None
                assert saved_world.name == world_name
                assert len(saved_world.stages) == len(world.stages)

            logger.success("✅ save_world_to_db 基本保存功能测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_save_world_with_stages_and_actors(self) -> None:
        """测试保存包含 Stages 和 Actors 的 World"""
        logger.info("🧪 测试 save_world_to_db - Stages 和 Actors")

        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库查询验证 Stages 和 Actors
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert saved_world is not None

                # 验证 Stages
                assert len(saved_world.stages) > 0
                stage_db = saved_world.stages[0]
                assert stage_db.name == world.stages[0].name

                # 验证 Actors
                assert len(stage_db.actors) > 0
                actor_db = stage_db.actors[0]
                assert actor_db.name == world.stages[0].actors[0].name

                # 验证数量
                assert len(saved_world.stages) == len(world.stages)
                assert len(saved_world.stages[0].actors) == len(world.stages[0].actors)

            logger.success("✅ Stages 和 Actors 保存测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_save_world_with_attributes_and_effects(self) -> None:
        """测试保存包含 Attributes 和 Effects 的 World"""
        logger.info("🧪 测试 save_world_to_db - Attributes 和 Effects")

        world = create_test_world1()
        world_name = world.name
        first_actor = world.stages[0].actors[0]

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库查询验证 Attributes 和 Effects
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert saved_world is not None

                # 验证 Attributes (一对一)
                actor_db = saved_world.stages[0].actors[0]
                assert actor_db.attributes is not None
                assert actor_db.attributes.health == first_actor.attributes.health
                assert (
                    actor_db.attributes.max_health == first_actor.attributes.max_health
                )
                assert actor_db.attributes.attack == first_actor.attributes.attack

                # 验证 Effects (一对多)
                if len(first_actor.effects) > 0:
                    assert len(actor_db.effects) == len(first_actor.effects)
                    effect_db = actor_db.effects[0]
                    effect = first_actor.effects[0]
                    assert effect_db.name == effect.name
                    assert effect_db.description == effect.description

            logger.success("✅ Attributes 和 Effects 保存测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_save_world_with_messages(self) -> None:
        """测试保存包含 Messages (context) 的 World"""
        logger.info("🧪 测试 save_world_to_db - Messages (context)")

        world = create_test_world1()
        world_name = world.name
        first_actor = world.stages[0].actors[0]

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库查询验证 Messages
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert saved_world is not None

                # 验证 Messages
                actor_db = saved_world.stages[0].actors[0]
                assert len(actor_db.context) == len(first_actor.context)

                # 验证 sequence 和 message_json
                for idx, message_db in enumerate(actor_db.context):
                    assert message_db.sequence == idx
                    assert message_db.message_json is not None
                    assert len(message_db.message_json) > 0

                # 验证 message 按 sequence 排序
                for i in range(len(actor_db.context) - 1):
                    assert (
                        actor_db.context[i].sequence < actor_db.context[i + 1].sequence
                    )

            logger.success("✅ Messages (context) 保存测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_load_world_from_db_basic(self) -> None:
        """测试基本的数据库查询功能"""
        logger.info("🧪 测试数据库查询 - 基本查询功能")

        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库直接查询验证
            with SessionLocal() as db:
                from sqlalchemy.orm import joinedload

                loaded_world = (
                    db.query(WorldDB)
                    .options(joinedload(WorldDB.stages).joinedload(StageDB.actors))
                    .filter_by(name=world_name)
                    .first()
                )

                # 验证查询结果
                assert loaded_world is not None
                assert loaded_world.name == world_name
                assert len(loaded_world.stages) == len(world.stages)

            logger.success("✅ 数据库查询基本功能测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_load_world_not_exists(self) -> None:
        """测试查询不存在的 World"""
        logger.info("🧪 测试数据库查询 - 不存在的 World")

        nonexistent_world_name = "definitely_does_not_exist_world_12345"

        # 查询不存在的 World 应该返回 None
        with SessionLocal() as db:
            loaded_world = (
                db.query(WorldDB).filter_by(name=nonexistent_world_name).first()
            )
            assert loaded_world is None

        logger.success("✅ 不存在的 World 查询测试通过")

    def test_delete_world_basic(self) -> None:
        """测试基本的 World 删除功能"""
        logger.info("🧪 测试 delete_world - 基本删除功能")

        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 验证存在
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert saved_world is not None

            # 删除
            result = delete_world(world_name)
            assert result is True

            # 验证已删除
            with SessionLocal() as db:
                deleted_world = db.query(WorldDB).filter_by(name=world_name).first()
                assert deleted_world is None

            logger.success("✅ delete_world 基本删除功能测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_delete_world_cascade(self) -> None:
        """测试 World 删除时的 CASCADE 删除"""
        logger.info("🧪 测试 delete_world - CASCADE 删除")

        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            # 在新 session 中获取关联数据 ID
            with SessionLocal() as db:
                saved_world = db.query(WorldDB).filter_by(id=world_id).first()
                assert saved_world is not None

                stage_ids = [stage.id for stage in saved_world.stages]
                actor_ids = [
                    actor.id for stage in saved_world.stages for actor in stage.actors
                ]

            # 删除 World
            delete_world(world_name)

            # 验证 World 已删除
            with SessionLocal() as db:
                assert db.query(WorldDB).filter_by(id=world_id).first() is None

                # 验证 Stages 已被 CASCADE 删除
                for stage_id in stage_ids:
                    assert db.query(StageDB).filter_by(id=stage_id).first() is None

                # 验证 Actors 已被 CASCADE 删除
                for actor_id in actor_ids:
                    assert db.query(ActorDB).filter_by(id=actor_id).first() is None

                # 验证 Attributes 已被 CASCADE 删除
                for actor_id in actor_ids:
                    assert (
                        db.query(AttributesDB).filter_by(actor_id=actor_id).first()
                        is None
                    )

                # 验证 Effects 已被 CASCADE 删除
                for actor_id in actor_ids:
                    assert db.query(EffectDB).filter_by(actor_id=actor_id).count() == 0

                # 验证 Messages 已被 CASCADE 删除
                for actor_id in actor_ids:
                    assert db.query(MessageDB).filter_by(actor_id=actor_id).count() == 0

            logger.success("✅ CASCADE 删除测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_delete_world_not_exists(self) -> None:
        """测试删除不存在的 World"""
        logger.info("🧪 测试 delete_world - 不存在的 World")

        nonexistent_world_name = "definitely_does_not_exist_world_12345"

        # 删除不存在的 World 应该返回 False
        result = delete_world(nonexistent_world_name)
        assert result is False

        logger.success("✅ 不存在的 World 删除测试通过")

    def test_data_integrity_after_save_and_load(self) -> None:
        """测试保存后的数据完整性"""
        logger.info("🧪 测试数据完整性 - save → query")

        world = create_test_world1()
        world_name = world.name

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库直接查询验证
            with SessionLocal() as db:
                from sqlalchemy.orm import joinedload

                loaded_world = (
                    db.query(WorldDB)
                    .options(
                        joinedload(WorldDB.stages)
                        .joinedload(StageDB.actors)
                        .joinedload(ActorDB.attributes),
                        joinedload(WorldDB.stages)
                        .joinedload(StageDB.actors)
                        .joinedload(ActorDB.effects),
                    )
                    .filter_by(name=world_name)
                    .first()
                )
                assert loaded_world is not None

                # 验证 World 基本属性
                assert loaded_world.name == world.name
                assert loaded_world.campaign_setting == world.campaign_setting

                # 验证 Stages (按名称匹配，不依赖顺序)
                assert len(loaded_world.stages) == len(world.stages)
                original_stages_dict = {stage.name: stage for stage in world.stages}

                for loaded_stage in loaded_world.stages:
                    assert loaded_stage.name in original_stages_dict
                    original_stage = original_stages_dict[loaded_stage.name]

                    assert loaded_stage.profile == original_stage.profile
                    assert loaded_stage.environment == original_stage.environment

                    # 验证 Actors (按名称匹配，不依赖顺序)
                    assert len(loaded_stage.actors) == len(original_stage.actors)
                    original_actors_dict = {
                        actor.name: actor for actor in original_stage.actors
                    }

                    for loaded_actor in loaded_stage.actors:
                        assert loaded_actor.name in original_actors_dict
                        original_actor = original_actors_dict[loaded_actor.name]

                        assert loaded_actor.profile == original_actor.profile
                        assert loaded_actor.appearance == original_actor.appearance

                        # 验证 Attributes
                        assert (
                            loaded_actor.attributes.health
                            == original_actor.attributes.health
                        )
                        assert (
                            loaded_actor.attributes.max_health
                            == original_actor.attributes.max_health
                        )
                        assert (
                            loaded_actor.attributes.attack
                            == original_actor.attributes.attack
                        )

                        # 验证 Effects (按名称匹配，不依赖顺序)
                        assert len(loaded_actor.effects) == len(original_actor.effects)
                        original_effects_dict = {
                            effect.name: effect for effect in original_actor.effects
                        }

                        for loaded_effect in loaded_actor.effects:
                            assert loaded_effect.name in original_effects_dict
                            original_effect = original_effects_dict[loaded_effect.name]
                            assert (
                                loaded_effect.description == original_effect.description
                            )

            logger.success("✅ 数据完整性测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_multiple_worlds(self) -> None:
        """测试同时保存和查询多个 World"""
        logger.info("🧪 测试多个 World 的保存和查询")

        worlds = [
            create_test_world1(),
            create_test_world_2_1(),
            create_test_world_2_2(),
            create_test_world3(),
        ]
        world_names = [world.name for world in worlds]

        try:
            # 保存所有 World
            for world in worlds:
                save_world_to_db(world)

            # 验证所有 World 都存在
            with SessionLocal() as db:
                for world_name in world_names:
                    saved_world = db.query(WorldDB).filter_by(name=world_name).first()
                    assert saved_world is not None
                    assert saved_world.name == world_name

            logger.success("✅ 多个 World 保存和查询测试通过")

        finally:
            for world_name in world_names:
                self._cleanup_test_world(world_name)

    def test_message_types_serialization(self) -> None:
        """测试不同 Message 类型的序列化"""
        logger.info("🧪 测试 Message 类型序列化 - SystemMessage/HumanMessage/AIMessage")

        world = create_test_world1()
        world_name = world.name
        first_actor = world.stages[0].actors[0]

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库直接查询验证
            with SessionLocal() as db:
                from sqlalchemy.orm import joinedload

                loaded_world = (
                    db.query(WorldDB)
                    .options(
                        joinedload(WorldDB.stages)
                        .joinedload(StageDB.actors)
                        .joinedload(ActorDB.context)
                    )
                    .filter_by(name=world_name)
                    .first()
                )
                assert loaded_world is not None

                loaded_actor = loaded_world.stages[0].actors[0]

                # 验证 Message 数量
                assert len(loaded_actor.context) == len(first_actor.context)

                # 验证 Message sequence 和 JSON 存储
                for idx, message_db in enumerate(loaded_actor.context):
                    assert message_db.sequence == idx
                    assert message_db.message_json is not None
                    assert len(message_db.message_json) > 0

            logger.success("✅ Message 类型序列化测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_world_with_multiple_stages(self) -> None:
        """测试包含多个 Stages 的 World"""
        logger.info("🧪 测试多 Stage World")

        # world3 包含 2 个 stages
        world = create_test_world3()
        world_name = world.name

        try:
            # 保存到数据库
            save_world_to_db(world)

            # 从数据库直接查询验证
            with SessionLocal() as db:
                from sqlalchemy.orm import joinedload

                loaded_world = (
                    db.query(WorldDB)
                    .options(joinedload(WorldDB.stages).joinedload(StageDB.actors))
                    .filter_by(name=world_name)
                    .first()
                )
                assert loaded_world is not None

                # 验证 Stages 数量
                assert len(loaded_world.stages) == len(world.stages)
                assert len(loaded_world.stages) == 2

                # 验证每个 Stage (按名称匹配,不依赖顺序)
                original_stages_dict = {stage.name: stage for stage in world.stages}
                for loaded_stage in loaded_world.stages:
                    assert loaded_stage.name in original_stages_dict
                    original_stage = original_stages_dict[loaded_stage.name]
                    assert len(loaded_stage.actors) == len(original_stage.actors)

            logger.success("✅ 多 Stage World 测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def _cleanup_test_world(self, world_name: str) -> None:
        """清理测试 World"""
        try:
            with SessionLocal() as db:
                test_world = db.query(WorldDB).filter_by(name=world_name).first()
                if test_world:
                    db.delete(test_world)
                    db.commit()
                    logger.info(f"✅ 测试 World '{world_name}' 清理成功")
        except Exception as e:
            logger.error(f"❌ 清理测试 World '{world_name}' 失败: {e}")

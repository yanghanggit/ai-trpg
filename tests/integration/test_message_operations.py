#!/usr/bin/env python3
"""
Message Operations 数据库操作集成测试

测试 message_operations.py 中的功能:
- get_actor_context: 读取 Actor 的对话上下文
- get_stage_context: 读取 Stage 的对话上下文
- get_world_context: 读取 World 的对话上下文
- add_actor_context: 添加消息到 Actor 的上下文
- add_stage_context: 添加消息到 Stage 的上下文
- add_world_context: 添加消息到 World 的上下文

Author: yanghanggit
Date: 2025-01-14
"""

from typing import Generator, List
from uuid import UUID
import pytest
from loguru import logger
from langchain.schema import BaseMessage, SystemMessage, HumanMessage, AIMessage

from src.ai_trpg.demo.world1 import create_test_world1
from src.ai_trpg.pgsql.world_operations import save_world_to_db, delete_world
from src.ai_trpg.pgsql.message_operations import (
    get_actor_context,
    get_stage_context,
    get_world_context,
    add_actor_context,
    add_stage_context,
    add_world_context,
)
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.message import MessageDB


class TestMessageOperations:
    """Message Operations 数据库操作测试类"""

    # 类变量存储测试 World 信息
    test_world_id: UUID
    test_world_name: str
    test_actor_name: str
    test_stage_name: str

    @pytest.fixture(scope="class", autouse=True)
    def setup_test_world(self) -> Generator[None, None, None]:
        """为整个测试类设置测试世界(class-scoped)"""
        # 确保表存在
        from src.ai_trpg.pgsql import pgsql_ensure_database_tables

        pgsql_ensure_database_tables()
        logger.info("✅ 数据库表已确保存在")

        # 创建测试世界
        test_world = create_test_world1()
        TestMessageOperations.test_world_name = test_world.name
        TestMessageOperations.test_actor_name = test_world.stages[0].actors[0].name
        TestMessageOperations.test_stage_name = test_world.stages[0].name

        # 测试前：清理可能存在的同名世界
        try:
            delete_world(TestMessageOperations.test_world_name)
            logger.info(
                f"🧹 已清理旧的测试世界: {TestMessageOperations.test_world_name}"
            )
        except Exception:
            pass

        # 保存世界到数据库
        world_db = save_world_to_db(test_world)
        TestMessageOperations.test_world_id = world_db.id
        logger.info(
            f"🌍 测试世界已创建: {TestMessageOperations.test_world_name} (ID: {TestMessageOperations.test_world_id})"
        )

        yield  # 运行所有测试

        # 测试后：清理
        delete_world(TestMessageOperations.test_world_name)
        logger.info(f"🧹 测试完成，已清理世界: {TestMessageOperations.test_world_name}")

    def test_get_actor_context_basic(self) -> None:
        """测试读取 Actor 的对话上下文"""
        logger.info("🧪 测试 get_actor_context - 基本读取")

        # 读取 Actor 的初始上下文
        context = get_actor_context(self.test_world_id, self.test_actor_name)

        # 验证返回的消息列表
        assert isinstance(context, list)
        assert len(context) > 0  # 测试世界中 Actor 应该有初始上下文
        assert all(isinstance(msg, BaseMessage) for msg in context)

        logger.success(f"✅ 读取到 {len(context)} 条 Actor 对话消息")

    def test_get_actor_context_nonexistent(self) -> None:
        """测试读取不存在的 Actor"""
        logger.info("🧪 测试 get_actor_context - 不存在的 Actor")

        context = get_actor_context(self.test_world_id, "不存在的角色名称")
        assert context == []

        logger.success("✅ 不存在的 Actor 返回空列表")

    def test_get_stage_context_empty(self) -> None:
        """测试读取 Stage 的对话上下文（初始为空）"""
        logger.info("🧪 测试 get_stage_context - 空上下文")

        # Stage 初始没有对话上下文
        context = get_stage_context(self.test_world_id, self.test_stage_name)
        assert context == []

        logger.success("✅ Stage 初始上下文为空")

    def test_get_world_context_empty(self) -> None:
        """测试读取 World 的对话上下文（初始为空）"""
        logger.info("🧪 测试 get_world_context - 空上下文")

        # World 初始没有对话上下文
        context = get_world_context(self.test_world_id)
        assert context == []

        logger.success("✅ World 初始上下文为空")

    def test_add_actor_context_basic(self) -> None:
        """测试添加消息到 Actor 的上下文"""
        logger.info("🧪 测试 add_actor_context - 基本添加")

        # 准备新消息
        new_messages = [
            HumanMessage(content="玩家的新消息"),
            AIMessage(content="AI 的回复"),
        ]

        # 获取初始消息数量
        initial_context = get_actor_context(self.test_world_id, self.test_actor_name)
        initial_count = len(initial_context)

        # 添加消息
        success = add_actor_context(
            self.test_world_id, self.test_actor_name, new_messages
        )
        assert success is True

        # 验证消息已添加
        updated_context = get_actor_context(self.test_world_id, self.test_actor_name)
        assert len(updated_context) == initial_count + len(new_messages)

        # 验证新消息的内容
        assert updated_context[-2].content == "玩家的新消息"
        assert updated_context[-1].content == "AI 的回复"

        logger.success("✅ 成功添加消息到 Actor 上下文")

    def test_add_actor_context_sequence(self) -> None:
        """测试消息的 sequence 自动递增"""
        logger.info("🧪 测试 add_actor_context - sequence 递增")

        # 添加第一批消息
        messages1: List[BaseMessage] = [HumanMessage(content="第一批消息")]
        add_actor_context(self.test_world_id, self.test_actor_name, messages1)

        # 添加第二批消息
        messages2: List[BaseMessage] = [HumanMessage(content="第二批消息")]
        add_actor_context(self.test_world_id, self.test_actor_name, messages2)

        # 验证数据库中的 sequence
        with SessionLocal() as db:
            from src.ai_trpg.pgsql.actor import ActorDB

            actor = (
                db.query(ActorDB)
                .join(ActorDB.stage)
                .filter(ActorDB.name == self.test_actor_name)
                .filter(ActorDB.stage.has(world_id=self.test_world_id))
                .first()
            )
            assert actor is not None

            # 验证 sequence 是连续的
            sequences = [msg.sequence for msg in actor.context]
            assert sequences == list(range(len(sequences)))

        logger.success("✅ sequence 自动递增测试通过")

    def test_add_actor_context_multiple_types(self) -> None:
        """测试添加不同类型的消息"""
        logger.info("🧪 测试 add_actor_context - 多种消息类型")

        # 准备不同类型的消息
        new_messages = [
            SystemMessage(content="系统消息"),
            HumanMessage(content="人类消息"),
            AIMessage(content="AI 消息"),
        ]

        # 添加消息
        success = add_actor_context(
            self.test_world_id, self.test_actor_name, new_messages
        )
        assert success is True

        # 读取并验证消息类型
        context = get_actor_context(self.test_world_id, self.test_actor_name)

        # 验证最后三条消息的类型
        assert isinstance(context[-3], SystemMessage)
        assert isinstance(context[-2], HumanMessage)
        assert isinstance(context[-1], AIMessage)

        logger.success("✅ 多种消息类型添加测试通过")

    def test_add_stage_context_basic(self) -> None:
        """测试添加消息到 Stage 的上下文"""
        logger.info("🧪 测试 add_stage_context - 基本添加")

        # 准备新消息
        new_messages = [
            SystemMessage(content="场景系统消息"),
            HumanMessage(content="场景中的对话"),
        ]

        # 添加消息
        success = add_stage_context(
            self.test_world_id, self.test_stage_name, new_messages
        )
        assert success is True

        # 验证消息已添加
        context = get_stage_context(self.test_world_id, self.test_stage_name)
        assert len(context) == len(new_messages)
        assert context[0].content == "场景系统消息"
        assert context[1].content == "场景中的对话"

        logger.success("✅ 成功添加消息到 Stage 上下文")

    def test_add_world_context_basic(self) -> None:
        """测试添加消息到 World 的上下文"""
        logger.info("🧪 测试 add_world_context - 基本添加")

        # 准备新消息
        new_messages = [
            SystemMessage(content="世界级别的系统消息"),
            AIMessage(content="世界叙述"),
        ]

        # 添加消息
        success = add_world_context(self.test_world_id, new_messages)
        assert success is True

        # 验证消息已添加
        context = get_world_context(self.test_world_id)
        assert len(context) == len(new_messages)
        assert context[0].content == "世界级别的系统消息"
        assert context[1].content == "世界叙述"

        logger.success("✅ 成功添加消息到 World 上下文")

    def test_add_actor_context_empty_list(self) -> None:
        """测试添加空消息列表"""
        logger.info("🧪 测试 add_actor_context - 空消息列表")

        # 获取初始消息数量
        initial_context = get_actor_context(self.test_world_id, self.test_actor_name)
        initial_count = len(initial_context)

        # 添加空列表
        success = add_actor_context(self.test_world_id, self.test_actor_name, [])
        assert success is True

        # 验证消息数量不变
        updated_context = get_actor_context(self.test_world_id, self.test_actor_name)
        assert len(updated_context) == initial_count

        logger.success("✅ 空消息列表添加测试通过")

    def test_add_actor_context_nonexistent(self) -> None:
        """测试向不存在的 Actor 添加消息"""
        logger.info("🧪 测试 add_actor_context - 不存在的 Actor")

        new_messages: List[BaseMessage] = [HumanMessage(content="测试消息")]
        success = add_actor_context(self.test_world_id, "不存在的角色", new_messages)
        assert success is False

        logger.success("✅ 不存在的 Actor 添加失败测试通过")

    def test_add_stage_context_nonexistent(self) -> None:
        """测试向不存在的 Stage 添加消息"""
        logger.info("🧪 测试 add_stage_context - 不存在的 Stage")

        new_messages: List[BaseMessage] = [HumanMessage(content="测试消息")]
        success = add_stage_context(self.test_world_id, "不存在的场景", new_messages)
        assert success is False

        logger.success("✅ 不存在的 Stage 添加失败测试通过")

    def test_add_world_context_nonexistent(self) -> None:
        """测试向不存在的 World 添加消息"""
        logger.info("🧪 测试 add_world_context - 不存在的 World")

        from uuid import uuid4

        fake_world_id = uuid4()
        new_messages: List[BaseMessage] = [HumanMessage(content="测试消息")]
        success = add_world_context(fake_world_id, new_messages)
        assert success is False

        logger.success("✅ 不存在的 World 添加失败测试通过")

    def test_message_order_preservation(self) -> None:
        """测试消息顺序的保持"""
        logger.info("🧪 测试消息顺序保持")

        # 准备有序的消息
        ordered_messages: List[BaseMessage] = [
            HumanMessage(content=f"消息 {i}") for i in range(1, 6)
        ]

        # 添加消息
        add_actor_context(self.test_world_id, self.test_actor_name, ordered_messages)

        # 读取消息并验证顺序
        context = get_actor_context(self.test_world_id, self.test_actor_name)

        # 验证最后5条消息的顺序
        last_five = context[-5:]
        for i, msg in enumerate(last_five, 1):
            assert msg.content == f"消息 {i}"

        logger.success("✅ 消息顺序保持测试通过")

    def test_concurrent_context_updates(self) -> None:
        """测试不同层级上下文的独立性"""
        logger.info("🧪 测试不同层级上下文独立性")

        # 向 Actor, Stage, World 分别添加消息
        actor_msg: List[BaseMessage] = [HumanMessage(content="Actor 消息")]
        stage_msg: List[BaseMessage] = [SystemMessage(content="Stage 消息")]
        world_msg: List[BaseMessage] = [AIMessage(content="World 消息")]

        add_actor_context(self.test_world_id, self.test_actor_name, actor_msg)
        add_stage_context(self.test_world_id, self.test_stage_name, stage_msg)
        add_world_context(self.test_world_id, world_msg)

        # 验证各自的上下文独立
        actor_context = get_actor_context(self.test_world_id, self.test_actor_name)
        stage_context = get_stage_context(self.test_world_id, self.test_stage_name)
        world_context = get_world_context(self.test_world_id)

        # Actor 上下文包含其消息
        assert any(msg.content == "Actor 消息" for msg in actor_context)

        # Stage 上下文只包含 Stage 消息
        assert len(stage_context) >= 1
        assert any(msg.content == "Stage 消息" for msg in stage_context)

        # World 上下文只包含 World 消息
        assert len(world_context) >= 1
        assert any(msg.content == "World 消息" for msg in world_context)

        logger.success("✅ 不同层级上下文独立性测试通过")

    def test_large_message_content(self) -> None:
        """测试大内容消息的存储和读取"""
        logger.info("🧪 测试大内容消息")

        # 创建大内容消息（模拟长对话）
        large_content = "这是一段很长的内容。" * 1000  # ~10KB
        large_message: List[BaseMessage] = [HumanMessage(content=large_content)]

        # 添加大消息
        success = add_actor_context(
            self.test_world_id, self.test_actor_name, large_message
        )
        assert success is True

        # 读取并验证内容完整
        context = get_actor_context(self.test_world_id, self.test_actor_name)
        assert context[-1].content == large_content

        logger.success("✅ 大内容消息测试通过")

    def test_batch_add_messages(self) -> None:
        """测试批量添加多条消息"""
        logger.info("🧪 测试批量添加消息")

        # 准备批量消息（模拟一次对话回合）
        batch_messages = [
            HumanMessage(content="用户问题1"),
            AIMessage(content="AI回答1"),
            HumanMessage(content="用户问题2"),
            AIMessage(content="AI回答2"),
            HumanMessage(content="用户问题3"),
            AIMessage(content="AI回答3"),
        ]

        # 获取初始数量
        initial_count = len(get_actor_context(self.test_world_id, self.test_actor_name))

        # 批量添加
        success = add_actor_context(
            self.test_world_id, self.test_actor_name, batch_messages
        )
        assert success is True

        # 验证数量
        updated_context = get_actor_context(self.test_world_id, self.test_actor_name)
        assert len(updated_context) == initial_count + len(batch_messages)

        # 验证顺序和内容
        last_six = updated_context[-6:]
        for i, (expected, actual) in enumerate(zip(batch_messages, last_six)):
            assert actual.content == expected.content
            assert type(actual) == type(expected)

        logger.success("✅ 批量添加消息测试通过")

    def test_message_type_conversion(self) -> None:
        """测试消息类型的正确转换（DB → LangChain）"""
        logger.info("🧪 测试消息类型转换")

        # 添加各种类型的消息
        messages = [
            SystemMessage(content="系统初始化"),
            HumanMessage(content="用户输入"),
            AIMessage(content="AI响应"),
        ]

        add_stage_context(self.test_world_id, self.test_stage_name, messages)

        # 读取并验证类型（读取最后添加的3条消息）
        context = get_stage_context(self.test_world_id, self.test_stage_name)
        last_three = context[-3:]  # 获取最后3条消息

        assert isinstance(last_three[0], SystemMessage)
        assert last_three[0].content == "系统初始化"

        assert isinstance(last_three[1], HumanMessage)
        assert last_three[1].content == "用户输入"

        assert isinstance(last_three[2], AIMessage)
        assert last_three[2].content == "AI响应"

        logger.success("✅ 消息类型转换测试通过")

    def test_cascade_delete_messages(self) -> None:
        """测试删除 World 时 Messages 被级联删除"""
        logger.info("🧪 测试级联删除 Messages")

        # 创建临时测试世界
        temp_world = create_test_world1()
        temp_world.name = "临时测试世界_消息级联删除"
        world_db = save_world_to_db(temp_world)
        temp_world_id = world_db.id

        try:
            # 向各层级添加消息
            add_world_context(temp_world_id, [HumanMessage(content="World 消息")])
            add_stage_context(
                temp_world_id,
                temp_world.stages[0].name,
                [HumanMessage(content="Stage 消息")],
            )
            add_actor_context(
                temp_world_id,
                temp_world.stages[0].actors[0].name,
                [HumanMessage(content="Actor 消息")],
            )

            # 在 session 内获取所有相关 ID 并验证消息存在
            with SessionLocal() as db:
                from src.ai_trpg.pgsql.world import WorldDB

                # 重新查询 world_db 以获取关联数据
                world_in_session = db.query(WorldDB).filter_by(id=temp_world_id).first()
                assert world_in_session is not None

                # 获取 stage 和 actor 的 ID
                stage_ids = [stage.id for stage in world_in_session.stages]
                actor_ids = [
                    actor.id
                    for stage in world_in_session.stages
                    for actor in stage.actors
                ]

                # 验证消息存在
                message_count = (
                    db.query(MessageDB)
                    .filter(
                        (MessageDB.world_id == temp_world_id)
                        | (MessageDB.stage_id.in_(stage_ids))
                        | (MessageDB.actor_id.in_(actor_ids))
                    )
                    .count()
                )
                assert message_count > 0

            # 删除 World
            delete_world(temp_world.name)

            # 验证相关的 Messages 都被删除
            with SessionLocal() as db:
                message_count = (
                    db.query(MessageDB)
                    .filter(MessageDB.world_id == temp_world_id)
                    .count()
                )
                assert message_count == 0

            logger.success("✅ 级联删除 Messages 测试通过")

        finally:
            # 确保清理
            try:
                delete_world(temp_world.name)
            except Exception:
                pass

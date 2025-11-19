#!/usr/bin/env python3
"""
场景图寻路功能测试

测试场景连接 (StageConnectionDB) 的图遍历和寻路功能。
使用 PostgreSQL 递归 CTE 查询测试场景间的路径查找。

测试场景:
- 线性路径：A -> B -> C -> D
- 分支路径：A -> B -> C 和 A -> B -> D
- 环形路径：A -> B -> C -> A
- 复杂图：多个分支和环
- 不可达路径：孤立的场景

Author: yanghanggit
Date: 2025-01-19
"""

from typing import Generator, List
import pytest
from loguru import logger
from uuid import UUID
from sqlalchemy.orm import Session

from src.ai_trpg.demo.models import World, Stage
from src.ai_trpg.pgsql.world_operations import save_world_to_db, delete_world
from src.ai_trpg.pgsql.client import SessionLocal
from src.ai_trpg.pgsql.world import WorldDB
from src.ai_trpg.pgsql.stage import StageDB
from src.ai_trpg.pgsql.stage_connection import StageConnectionDB


class TestStagePathfinding:
    """场景图寻路测试类"""

    @pytest.fixture(autouse=True)
    def cleanup_test_worlds(self) -> Generator[None, None, None]:
        """测试前后自动清理测试世界"""
        test_world_names = [
            "test_pathfinding_linear",
            "test_pathfinding_branched",
            "test_pathfinding_cyclic",
            "test_pathfinding_complex",
            "test_pathfinding_isolated",
        ]

        # 测试前清理
        for world_name in test_world_names:
            self._cleanup_test_world(world_name)

        yield  # 运行测试

        # 测试后清理
        for world_name in test_world_names:
            self._cleanup_test_world(world_name)

    def test_pathfinding_linear_graph(self) -> None:
        """测试线性图寻路：A -> B -> C -> D"""
        logger.info("🧪 测试线性图寻路")

        world_name = "test_pathfinding_linear"
        world = self._create_linear_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            with SessionLocal() as db:
                # 获取场景名称到ID的映射
                stage_map = self._get_stage_map(db, world_id)

                # 测试 A -> D 的路径（应该经过 B 和 C）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景D"])
                assert path is not None
                assert len(path) == 4  # A -> B -> C -> D
                assert path == [
                    stage_map["场景A"],
                    stage_map["场景B"],
                    stage_map["场景C"],
                    stage_map["场景D"],
                ]

                # 测试 A -> B 的路径（直接连接）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景B"])
                assert path is not None
                assert len(path) == 2  # A -> B
                assert path == [stage_map["场景A"], stage_map["场景B"]]

                # 测试 A -> C 的路径（经过 B）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景C"])
                assert path is not None
                assert len(path) == 3  # A -> B -> C
                assert path == [
                    stage_map["场景A"],
                    stage_map["场景B"],
                    stage_map["场景C"],
                ]

                # 测试反向路径 D -> A（不应该存在，因为是单向图）
                path = self._find_path_cte(db, stage_map["场景D"], stage_map["场景A"])
                assert path is None or len(path) == 0

            logger.success("✅ 线性图寻路测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_pathfinding_branched_graph(self) -> None:
        """测试分支图寻路：A -> B，然后 B -> C 和 B -> D"""
        logger.info("🧪 测试分支图寻路")

        world_name = "test_pathfinding_branched"
        world = self._create_branched_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            with SessionLocal() as db:
                stage_map = self._get_stage_map(db, world_id)

                # 测试 A -> C 的路径（A -> B -> C）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景C"])
                assert path is not None
                assert len(path) == 3
                assert path == [
                    stage_map["场景A"],
                    stage_map["场景B"],
                    stage_map["场景C"],
                ]

                # 测试 A -> D 的路径（A -> B -> D）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景D"])
                assert path is not None
                assert len(path) == 3
                assert path == [
                    stage_map["场景A"],
                    stage_map["场景B"],
                    stage_map["场景D"],
                ]

                # 测试 C -> D 的路径（不应该存在直接路径）
                path = self._find_path_cte(db, stage_map["场景C"], stage_map["场景D"])
                assert path is None or len(path) == 0

            logger.success("✅ 分支图寻路测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_pathfinding_cyclic_graph(self) -> None:
        """测试环形图寻路：A -> B -> C -> A（形成环）"""
        logger.info("🧪 测试环形图寻路")

        world_name = "test_pathfinding_cyclic"
        world = self._create_cyclic_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            with SessionLocal() as db:
                stage_map = self._get_stage_map(db, world_id)

                # 测试 A -> C 的路径（A -> B -> C）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景C"])
                assert path is not None
                assert len(path) == 3
                assert path == [
                    stage_map["场景A"],
                    stage_map["场景B"],
                    stage_map["场景C"],
                ]

                # 测试 C -> A 的路径（环的一部分，C -> A）
                path = self._find_path_cte(db, stage_map["场景C"], stage_map["场景A"])
                assert path is not None
                assert len(path) == 2
                assert path == [stage_map["场景C"], stage_map["场景A"]]

                # 测试 B -> A 的路径（B -> C -> A）
                path = self._find_path_cte(db, stage_map["场景B"], stage_map["场景A"])
                assert path is not None
                assert len(path) == 3
                assert path == [
                    stage_map["场景B"],
                    stage_map["场景C"],
                    stage_map["场景A"],
                ]

            logger.success("✅ 环形图寻路测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_pathfinding_complex_graph(self) -> None:
        """测试复杂图寻路：多条路径和环的组合"""
        logger.info("🧪 测试复杂图寻路")

        world_name = "test_pathfinding_complex"
        world = self._create_complex_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            with SessionLocal() as db:
                stage_map = self._get_stage_map(db, world_id)

                # 测试存在多条路径的情况（寻找最短路径）
                # A -> E 可以通过 A -> B -> D -> E 或 A -> C -> D -> E
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景E"])
                assert path is not None
                assert len(path) >= 4  # 至少4个节点

                # 验证路径的起点和终点
                assert path[0] == stage_map["场景A"]
                assert path[-1] == stage_map["场景E"]

                # 验证路径的连续性（每一步都有连接）
                for i in range(len(path) - 1):
                    assert self._has_connection(db, path[i], path[i + 1])

            logger.success("✅ 复杂图寻路测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_pathfinding_isolated_stages(self) -> None:
        """测试孤立场景：某些场景不可达"""
        logger.info("🧪 测试孤立场景寻路")

        world_name = "test_pathfinding_isolated"
        world = self._create_isolated_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            with SessionLocal() as db:
                stage_map = self._get_stage_map(db, world_id)

                # 测试连通的场景 A -> B
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景B"])
                assert path is not None
                assert len(path) == 2

                # 测试不连通的场景 A -> C（C 是孤立的）
                path = self._find_path_cte(db, stage_map["场景A"], stage_map["场景C"])
                assert path is None or len(path) == 0

                # 测试不连通的场景 B -> C（C 是孤立的）
                path = self._find_path_cte(db, stage_map["场景B"], stage_map["场景C"])
                assert path is None or len(path) == 0

            logger.success("✅ 孤立场景寻路测试通过")

        finally:
            self._cleanup_test_world(world_name)

    def test_stage_connections_cascade_delete(self) -> None:
        """测试删除场景时连接的级联删除"""
        logger.info("🧪 测试场景连接的级联删除")

        world_name = "test_pathfinding_linear"
        world = self._create_linear_world(world_name)

        try:
            # 保存到数据库
            world_db = save_world_to_db(world)
            world_id = world_db.id

            # 验证连接已创建
            with SessionLocal() as db:
                connection_count = (
                    db.query(StageConnectionDB)
                    .join(
                        StageDB,
                        StageConnectionDB.source_stage_id == StageDB.id,
                    )
                    .filter(StageDB.world_id == world_id)
                    .count()
                )
                assert connection_count == 3  # A->B, B->C, C->D

            # 删除世界
            delete_world(world_name)

            # 验证连接也被删除
            with SessionLocal() as db:
                connection_count = (
                    db.query(StageConnectionDB)
                    .join(
                        StageDB,
                        StageConnectionDB.source_stage_id == StageDB.id,
                    )
                    .filter(StageDB.world_id == world_id)
                    .count()
                )
                assert connection_count == 0

            logger.success("✅ 场景连接级联删除测试通过")

        finally:
            self._cleanup_test_world(world_name)

    # ========================================================================
    # 辅助方法：创建测试世界
    # ========================================================================

    def _create_linear_world(self, world_name: str) -> World:
        """创建线性图世界：A -> B -> C -> D"""
        stage_a = Stage(
            name="场景A",
            profile="起点",
            environment="开始区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景A -> 场景B",
            stage_connections=["场景B"],
        )

        stage_b = Stage(
            name="场景B",
            profile="中转点1",
            environment="中间区域1",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景B -> 场景C",
            stage_connections=["场景C"],
        )

        stage_c = Stage(
            name="场景C",
            profile="中转点2",
            environment="中间区域2",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景C -> 场景D",
            stage_connections=["场景D"],
        )

        stage_d = Stage(
            name="场景D",
            profile="终点",
            environment="结束区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        return World(
            name=world_name,
            campaign_setting="线性路径测试",
            stages=[stage_a, stage_b, stage_c, stage_d],
        )

    def _create_branched_world(self, world_name: str) -> World:
        """创建分支图世界：A -> B，B -> C 和 B -> D"""
        stage_a = Stage(
            name="场景A",
            profile="起点",
            environment="开始区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景A -> 场景B",
            stage_connections=["场景B"],
        )

        stage_b = Stage(
            name="场景B",
            profile="分支点",
            environment="分叉区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景B -> 场景C, 场景B -> 场景D",
            stage_connections=["场景C", "场景D"],
        )

        stage_c = Stage(
            name="场景C",
            profile="分支终点1",
            environment="终点区域1",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        stage_d = Stage(
            name="场景D",
            profile="分支终点2",
            environment="终点区域2",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        return World(
            name=world_name,
            campaign_setting="分支路径测试",
            stages=[stage_a, stage_b, stage_c, stage_d],
        )

    def _create_cyclic_world(self, world_name: str) -> World:
        """创建环形图世界：A -> B -> C -> A"""
        stage_a = Stage(
            name="场景A",
            profile="环的起点",
            environment="环形区域A",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景A -> 场景B",
            stage_connections=["场景B"],
        )

        stage_b = Stage(
            name="场景B",
            profile="环的中点",
            environment="环形区域B",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景B -> 场景C",
            stage_connections=["场景C"],
        )

        stage_c = Stage(
            name="场景C",
            profile="环的回点",
            environment="环形区域C",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景C -> 场景A",
            stage_connections=["场景A"],
        )

        return World(
            name=world_name,
            campaign_setting="环形路径测试",
            stages=[stage_a, stage_b, stage_c],
        )

    def _create_complex_world(self, world_name: str) -> World:
        """创建复杂图世界：多条路径和环的组合

        结构：
        A -> B -> D -> E
        A -> C -> D -> E
        D -> B (形成环)
        """
        stage_a = Stage(
            name="场景A",
            profile="起点",
            environment="起始区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景A -> 场景B, 场景A -> 场景C",
            stage_connections=["场景B", "场景C"],
        )

        stage_b = Stage(
            name="场景B",
            profile="路径1",
            environment="路径1区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景B -> 场景D",
            stage_connections=["场景D"],
        )

        stage_c = Stage(
            name="场景C",
            profile="路径2",
            environment="路径2区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景C -> 场景D",
            stage_connections=["场景D"],
        )

        stage_d = Stage(
            name="场景D",
            profile="汇合点",
            environment="汇合区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景D -> 场景E, 场景D -> 场景B",
            stage_connections=["场景E", "场景B"],
        )

        stage_e = Stage(
            name="场景E",
            profile="终点",
            environment="终点区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        return World(
            name=world_name,
            campaign_setting="复杂路径测试",
            stages=[stage_a, stage_b, stage_c, stage_d, stage_e],
        )

    def _create_isolated_world(self, world_name: str) -> World:
        """创建包含孤立场景的世界：A -> B, C（孤立）"""
        stage_a = Stage(
            name="场景A",
            profile="连通区域起点",
            environment="可达区域A",
            actors=[],
            narrative="",
            actor_states="",
            connections="场景A -> 场景B",
            stage_connections=["场景B"],
        )

        stage_b = Stage(
            name="场景B",
            profile="连通区域终点",
            environment="可达区域B",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        stage_c = Stage(
            name="场景C",
            profile="孤立区域",
            environment="不可达区域",
            actors=[],
            narrative="",
            actor_states="",
            connections="",
            stage_connections=[],
        )

        return World(
            name=world_name,
            campaign_setting="孤立场景测试",
            stages=[stage_a, stage_b, stage_c],
        )

    # ========================================================================
    # 辅助方法：寻路算法（使用 PostgreSQL 递归 CTE）
    # ========================================================================

    def _get_stage_map(self, db: Session, world_id: UUID) -> dict[str, UUID]:
        """获取场景名称到 ID 的映射"""
        stages = db.query(StageDB).filter(StageDB.world_id == world_id).all()
        return {stage.name: stage.id for stage in stages}

    def _find_path_cte(
        self, db: Session, start_id: UUID, end_id: UUID
    ) -> List[UUID] | None:
        """使用递归 CTE 查找两个场景之间的路径

        返回场景 ID 列表表示路径，如果不存在路径则返回 None
        """
        from sqlalchemy import text

        # PostgreSQL 递归 CTE 查询
        query = text(
            """
            WITH RECURSIVE path AS (
                -- 基础情况：起始场景
                SELECT 
                    source_stage_id,
                    target_stage_id,
                    ARRAY[source_stage_id, target_stage_id] as path,
                    1 as depth
                FROM stage_connections
                WHERE source_stage_id = :start_id
                
                UNION ALL
                
                -- 递归情况：扩展路径
                SELECT 
                    sc.source_stage_id,
                    sc.target_stage_id,
                    p.path || sc.target_stage_id,
                    p.depth + 1
                FROM stage_connections sc
                INNER JOIN path p ON p.target_stage_id = sc.source_stage_id
                WHERE NOT sc.target_stage_id = ANY(p.path)  -- 防止环路
                  AND p.depth < 10  -- 限制最大深度
            )
            SELECT path
            FROM path
            WHERE target_stage_id = :end_id
            ORDER BY depth
            LIMIT 1;
        """
        )

        result = db.execute(query, {"start_id": start_id, "end_id": end_id})
        row = result.fetchone()

        if row and row[0]:
            return list(row[0])
        return None

    def _has_connection(self, db: Session, source_id: UUID, target_id: UUID) -> bool:
        """检查两个场景之间是否存在直接连接"""
        connection = (
            db.query(StageConnectionDB)
            .filter(
                StageConnectionDB.source_stage_id == source_id,
                StageConnectionDB.target_stage_id == target_id,
            )
            .first()
        )
        return connection is not None

    def _cleanup_test_world(self, world_name: str) -> None:
        """清理测试 World"""
        try:
            delete_world(world_name)
        except Exception as e:
            logger.debug(f"清理测试 World '{world_name}' 时出现异常（可能不存在）: {e}")

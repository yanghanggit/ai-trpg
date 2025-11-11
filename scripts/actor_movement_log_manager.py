#!/usr/bin/env python3
"""
角色移动日志管理模块

提供角色在场景间移动事件的记录、查询和管理功能。
用于测试和追踪 Actor 在 Stage 之间的移动历史。
"""

from pathlib import Path
from typing import List
from loguru import logger
from pydantic import BaseModel
from ai_trpg.configuration.game import LOGS_DIR


class ActorMovementEvent(BaseModel):
    """单次角色移动事件记录"""

    actor_name: str  # 角色名称
    from_stage: str  # 来源场景名称
    to_stage: str  # 目标场景名称
    description: str  # 事件描述，例如 f"成功将角色 '{actor_name}' 从场景 '{source_stage_name}' 移动到 '{result_stage.name}'"
    entry_posture_and_status: str = (
        ""  # 进入姿态与状态：角色以什么姿态和状态进入目标场景。格式："姿态 | 状态"，如"左手持油灯，谨慎跨入 | 【隐藏】"
    )


class ActorMovementLog(BaseModel):
    """角色移动事件日志集合"""

    events: List[ActorMovementEvent] = []


def _get_actor_movement_log_filepath() -> Path:
    """获取角色移动日志文件路径的辅助函数

    Returns:
        Path: 角色移动日志文件的完整路径
    """
    json_filename = "actor_movement_log.json"
    return LOGS_DIR / json_filename


def _save_actor_movement_log(log: ActorMovementLog, filepath: Path) -> None:
    """将角色移动日志保存为 JSON 文件

    Args:
        log: 要保存的角色移动日志对象
        filepath: 日志文件的完整路径（Path对象）

    Raises:
        Exception: 保存失败时抛出异常
    """
    try:
        # 使用 Pydantic 的 model_dump_json 直接序列化为 JSON 字符串
        filepath.write_text(
            log.model_dump_json(indent=2, ensure_ascii=False), encoding="utf-8"
        )

        logger.debug(f"💾 角色移动日志已保存到: {filepath}")
    except Exception as e:
        logger.error(f"❌ 保存角色移动日志失败: {e}")
        raise


def _load_actor_movement_log(filepath: Path) -> ActorMovementLog:
    """从 JSON 文件加载角色移动日志

    Args:
        filepath: 日志文件的完整路径（Path对象）

    Returns:
        ActorMovementLog: 加载的角色移动日志对象，如果文件不存在则返回空日志

    Raises:
        Exception: 读取或解析失败时抛出异常
    """
    # 如果文件不存在，返回空日志
    if not filepath.exists():
        logger.warning(f"⚠️ 角色移动日志文件不存在: {filepath}，返回空日志")
        return ActorMovementLog()

    try:
        # 使用 Pydantic 的 model_validate_json 直接从 JSON 字符串解析
        log = ActorMovementLog.model_validate_json(filepath.read_text(encoding="utf-8"))

        logger.debug(f"📖 角色移动日志已加载: {filepath}，事件数量: {len(log.events)}")
        return log
    except Exception as e:
        logger.error(f"❌ 加载角色移动日志失败: {e}")
        raise


def has_actor_movement_event(actor_name: str, from_stage: str, to_stage: str) -> bool:
    """检查是否存在指定的角色移动事件

    Args:
        actor_name: 角色名称
        from_stage: 来源场景名称
        to_stage: 目标场景名称

    Returns:
        bool: 如果存在匹配的事件返回 True，否则返回 False
    """
    log = _load_actor_movement_log(_get_actor_movement_log_filepath())

    for event in log.events:
        if (
            event.actor_name == actor_name
            and event.from_stage == from_stage
            and event.to_stage == to_stage
        ):
            return True

    return False


def add_actor_movement_event(event: ActorMovementEvent) -> None:
    """添加角色移动事件到日志

    Args:
        event: 要添加的角色移动事件
    """
    filepath = _get_actor_movement_log_filepath()
    log = _load_actor_movement_log(filepath)
    log.events.append(event)
    _save_actor_movement_log(log, filepath)
    logger.info(
        f"✅ 已添加角色移动事件: {event.actor_name} ({event.from_stage} -> {event.to_stage})"
    )


def get_actor_movement_events(
    actor_name: str | None = None,
    from_stage: str | None = None,
    to_stage: str | None = None,
) -> List[ActorMovementEvent]:
    """获取符合条件的角色移动事件列表

    Args:
        actor_name: 角色名称（可选，不指定则不过滤）
        from_stage: 来源场景名称（可选，不指定则不过滤）
        to_stage: 目标场景名称（可选，不指定则不过滤）

    Returns:
        List[ActorMovementEvent]: 符合条件的事件列表
    """
    log = _load_actor_movement_log(_get_actor_movement_log_filepath())
    result = []

    for event in log.events:
        # 如果指定了条件，则检查是否匹配
        if actor_name is not None and event.actor_name != actor_name:
            continue
        if from_stage is not None and event.from_stage != from_stage:
            continue
        if to_stage is not None and event.to_stage != to_stage:
            continue

        result.append(event)

    return result


def remove_actor_movement_log() -> None:
    """清空角色移动日志文件"""
    filepath = _get_actor_movement_log_filepath()
    if filepath.exists():
        filepath.unlink()
        logger.info(f"🗑️ 已清空角色移动日志文件: {filepath}")
    else:
        logger.warning(f"⚠️ 角色移动日志文件不存在，无需清空: {filepath}")

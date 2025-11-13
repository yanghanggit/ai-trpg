"""
User 数据库操作模块

提供用户的 CRUD 操作:
- save_user: 创建新用户
- has_user: 检查用户是否存在
- get_user: 获取用户信息

Author: yanghanggit
Date: 2025-01-13
"""

from .user import UserDB
from .client import SessionLocal


def save_user(username: str, hashed_password: str, display_name: str) -> UserDB:
    """
    保存用户到PostgreSQL数据库

    参数:
        username: 用户名
        hashed_password: 哈希后的密码
        display_name: 显示名称

    返回:
        UserDB 对象，包含创建时间和更新时间
    """
    with SessionLocal() as db:
        try:
            user = UserDB(
                username=username,
                hashed_password=hashed_password,
                display_name=display_name,
                # created_at 和 updated_at 会自动处理
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            return user
        except Exception as e:
            db.rollback()
            raise e


def has_user(username: str) -> bool:
    """
    检查用户是否存在于PostgreSQL数据库中

    参数:
        username: 用户名

    返回:
        bool: 如果用户存在返回True，否则返回False
    """
    with SessionLocal() as db:
        return db.query(UserDB).filter_by(username=username).first() is not None


def get_user(username: str) -> UserDB:
    """
    从PostgreSQL数据库获取用户

    参数:
        username: 用户名

    返回:
        UserDB 对象
    """
    with SessionLocal() as db:
        user = db.query(UserDB).filter_by(username=username).first()
        if not user:
            raise ValueError(f"用户 '{username}' 不存在")
        return user

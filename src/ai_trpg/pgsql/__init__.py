"""
Database access layer for the nirva_service application.

This module provides:
- Database clients (PostgreSQL)
- ORM models and mappings
- Database utilities and helpers
- Data access objects (DAOs)
"""

from typing import List
from .base import *
from .client import *
from .user import *
from .vector_document import VectorDocumentDB
from .world import WorldDB
from .stage import StageDB
from .actor import ActorDB
from .effect import EffectDB
from .message import MessageDB
from .attributes import AttributesDB
from .config import PostgreSQLConfig, postgresql_config


__all__: List[str] = [
    # PostgreSQL configuration
    "PostgreSQLConfig",
    "postgresql_config",
    # Database management functions
    "pgsql_database_exists",
    "pgsql_create_database",
    "pgsql_drop_database",
    "pgsql_ensure_database_tables",
    # User database models and functions
    "UserDB",
    "save_user",
    "has_user",
    "get_user",
    # Vector database models
    "VectorDocumentDB",
    # World database models
    "WorldDB",
    "StageDB",
    "ActorDB",
    "EffectDB",
    "MessageDB",
    "AttributesDB",
]

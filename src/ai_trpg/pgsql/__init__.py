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
from .user import UserDB
from .user_operations import save_user, has_user, get_user
from .vector_document import VectorDocumentDB
from .world import WorldDB
from .stage import StageDB
from .actor import ActorDB
from .effect import EffectDB
from .message import MessageDB
from .attributes import AttributesDB
from .actor_movement_event import ActorMovementEventDB
from .config import PostgreSQLConfig, postgresql_config
from .world_operations import (
    save_world_to_db,
    load_world_from_db,
    get_world_id_by_name,
    delete_world,
    set_world_kickoff,
    get_world_kickoff,
    get_world_stages_and_actors,
    move_actor_to_stage_db,
)
from .actor_movement_event_operations import (
    save_actor_movement_event_to_db,
    get_actor_movement_events_by_actor,
    get_actor_movement_events_by_stage,
    clear_all_actor_movement_events,
)
from .message_operations import (
    get_actor_context,
    get_stage_context,
    get_world_context,
    add_actor_context,
    add_stage_context,
    add_world_context,
)

from .stage_operations import update_stage_info, get_stage_by_name, get_stages_in_world
from .actor_operations import (
    update_actor_appearance,
    update_actor_health,
    add_actor_effect,
    remove_actor_effect,
    get_actors_in_world,
)


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
    # Actor movement event models
    "ActorMovementEventDB",
    # World operations
    "save_world_to_db",
    "load_world_from_db",
    "get_world_id_by_name",
    "delete_world",
    "set_world_kickoff",
    "get_world_kickoff",
    "get_world_stages_and_actors",
    "move_actor_to_stage_db",
    # Actor movement event operations
    "save_actor_movement_event_to_db",
    "get_actor_movement_events_by_actor",
    "get_actor_movement_events_by_stage",
    "clear_all_actor_movement_events",
    # Message operations
    "get_actor_context",
    "get_stage_context",
    "get_world_context",
    "add_actor_context",
    "add_stage_context",
    "add_world_context",
    # Stage operations
    "update_stage_info",
    "get_stage_by_name",
    "get_stages_in_world",
    # Actor operations
    "update_actor_appearance",
    "update_actor_health",
    "add_actor_effect",
    "remove_actor_effect",
    "get_actors_in_world",
]

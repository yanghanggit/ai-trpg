"""Demo actors, stages, and world for the multi-agents game framework."""

from .models import Effect, Actor, Stage, World
from .system_messages import (
    GLOBAL_GAME_MECHANICS,
    gen_world_system_message,
    gen_actor_system_message,
    gen_stage_system_message,
)

from .world1 import create_test_world1
from .knowledge_base import test_knowledge_base1

__all__ = [
    "Effect",
    "Actor",
    "Stage",
    "World",
    "create_test_world1",
    "test_knowledge_base1",
    "GLOBAL_GAME_MECHANICS",
    "gen_world_system_message",
    "gen_actor_system_message",
    "gen_stage_system_message",
]

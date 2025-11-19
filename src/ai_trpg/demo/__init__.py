"""Demo actors, stages, and world for the multi-agents game framework."""

from .models import Effect, Actor, Stage, World
from .prompts import GLOBAL_GAME_MECHANICS
from .prompt_generators import (
    gen_world_system_prompt,
    gen_actor_system_prompt,
    gen_stage_system_prompt,
)
from .knowledge_base import test_knowledge_base1, test_queries_for_knowledge_base1
from .world1 import create_test_world1
from .world2 import create_test_world_2_1, create_test_world_2_2
from .world3 import create_test_world3


def create_demo_world() -> World:
    return create_test_world_2_2()


def get_demo_world_name() -> str:
    return create_demo_world().name


__all__ = [
    "Effect",
    "Actor",
    "Stage",
    "World",
    "test_knowledge_base1",
    "test_queries_for_knowledge_base1",
    "GLOBAL_GAME_MECHANICS",
    "gen_world_system_prompt",
    "gen_actor_system_prompt",
    "gen_stage_system_prompt",
    "create_test_world1",
    "create_test_world_2_1",
    "create_test_world_2_2",
    "create_test_world3",
    "create_demo_world",
]

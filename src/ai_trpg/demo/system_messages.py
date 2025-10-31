from typing import Final
from .models import Actor, Stage, World


# ============================================================================
# 全局游戏机制提示词
# ============================================================================
GLOBAL_GAME_MECHANICS: Final[
    str
] = """### 核心规则

1. **名字精确匹配**：实体名字必须完全一致，不可添加前缀或后缀。例如"加斯科因"不能称为"加斯科因神父"。

2. **世界结构**：World 包含 Stage，Stage 包含 Actor 和子 Stage。Actor 必须位于 Stage 中，只能与同一 Stage 的 Actor 直接互动。

3. **沉浸叙事**：你知晓所有规则，但禁止使用"根据游戏规则"、"按照设定"等元游戏语言。规则应通过角色行为和故事自然呈现，始终保持角色视角。"""


def gen_world_system_message(world: World, global_game_mechanics: str) -> str:
    """生成世界的系统消息

    Args:
        world: 世界模型实例
        global_game_mechanics: 全局游戏机制规则文本

    Returns:
        格式化的世界系统消息字符串
    """
    return f"""# {world.name}

你是游戏世界 {world.name} 的管理员,负责维护世界秩序和逻辑一致性。
实体类型: {World.__name__}

## 战役设定

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 管理世界状态,遵守规则,响应玩家指令。"""


def gen_actor_system_message(
    actor_model: Actor, world: World, global_game_mechanics: str
) -> str:
    """生成角色的系统消息

    Args:
        actor_model: 角色模型实例
        world: 世界模型实例
        global_game_mechanics: 全局游戏机制规则文本

    Returns:
        格式化的角色系统消息字符串
    """
    return f"""# {actor_model.name}

你扮演角色 {actor_model.name},实体类型: {Actor.__name__}

## 人物设定

{actor_model.profile}

## 外观

{actor_model.appearance}

## 世界: {world.name}

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 符合角色设定,推动故事发展,增加沉浸感。"""


def gen_stage_system_message(
    stage_model: Stage, world: World, global_game_mechanics: str
) -> str:
    """生成场景的系统消息

    Args:
        stage_model: 场景模型实例
        world: 世界模型实例
        global_game_mechanics: 全局游戏机制规则文本

    Returns:
        格式化的场景系统消息字符串
    """
    return f"""# {stage_model.name}

你扮演场景 {stage_model.name},实体类型: {Stage.__name__}

## 场景设定

{stage_model.profile}

## 场景环境

{stage_model.environment}

## 世界: {world.name}

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 描述场景氛围和角色互动,推动故事发展。"""

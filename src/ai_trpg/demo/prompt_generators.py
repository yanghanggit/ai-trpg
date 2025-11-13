from .models import Actor, Stage, World


def gen_world_system_prompt(world: World, global_game_mechanics: str) -> str:
    """生成世界的系统消息

    Args:
        world: 世界模型实例
        global_game_mechanics: 全局游戏机制规则文本

    Returns:
        格式化的世界系统消息字符串
    """
    return f"""# {world.name}

你扮演游戏世界的管理员,负责维护世界秩序和逻辑一致性。
实体类型: {World.__name__}
**当前世界**: {world.name}

## 战役设定

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 管理世界状态,遵守规则,响应指令。"""


def gen_actor_system_prompt(
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

你扮演角色,实体类型: {Actor.__name__}
**当前世界**: {world.name}

## 人物设定

{actor_model.profile}

## 外观

{actor_model.appearance}

## 世界背景

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 符合角色设定,推动故事发展,增加沉浸感。"""


def gen_stage_system_prompt(
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

你扮演场景,实体类型: {Stage.__name__}
**当前世界**: {world.name}

## 场景设定

{stage_model.profile}

## 场景环境

{stage_model.environment}

## 世界背景

{world.campaign_setting}

## 全局游戏机制规则

{global_game_mechanics}

**职责**: 描述场景氛围和角色互动,推动故事发展。"""

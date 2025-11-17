from .models import World, Effect
from .templates import (
    template_actor1,
    template_actor2,
    template_actor3,
    template_stage1,
    template_world1,
)
import copy
from langchain.schema import SystemMessage, HumanMessage, AIMessage
from .prompts import GLOBAL_GAME_MECHANICS
from .prompt_generators import (
    gen_world_system_prompt,
    gen_actor_system_prompt,
    gen_stage_system_prompt,
    gen_actor_kickoff_prompt,
)

# ============================================================================
# 游戏世界实例创建函数
# ============================================================================


def create_test_world1() -> World:

    # 深拷贝角色和场景，避免修改原始定义
    instance_actor1 = copy.deepcopy(template_actor1)
    instance_actor2 = copy.deepcopy(template_actor2)
    instance_actor3 = copy.deepcopy(template_actor3)
    # 深拷贝场景，避免修改原始定义
    instance_stage1 = copy.deepcopy(template_stage1)
    # 深拷贝世界，避免修改原始定义
    instance_world1 = copy.deepcopy(template_world1)

    # 创建世界
    instance_world1.name = f"""{instance_world1.name}_1"""
    instance_world1.context = [
        SystemMessage(
            content=gen_world_system_prompt(instance_world1, GLOBAL_GAME_MECHANICS)
        )
    ]

    # 创建场景
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。
**{instance_actor1.name}**: 手中的猎人斧随着他沉重的步伐不时触碰地面，发出金属摩擦的刺耳声响。他时而仰望血月，时而低头凝视地面，像一头困在笼中的野兽，理智与疯狂在他体内激烈交战。
**{instance_actor2.name}**: 乌鸦羽毛斗篷与夜色完全融为一体，无法被其他人察觉。她如同死神般静立，一动不动地观察着墓地内的一切，尤其是她的猎物——{instance_actor1.name}。
**{instance_actor3.name}**: 刚刚穿过铁栅栏门进入墓地南侧入口内部约10米处，环顾四周，试图弄清楚接下来该做什么。这座被诅咒的城市对他来说充满了未知与危险。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor1.name}**: 墓地中央，靠近天使雕像 | 来回踱步 | 手持猎人斧
**{instance_actor2.name}**: 墓地东侧，黑色铁门旁的墓碑阴影中 | 隐藏状态 | 保持静止观察
**{instance_actor3.name}**: 墓地南侧入口，距铁栅栏门约10米 | 站立 | 环顾四周"""

    # 设置上下文！
    instance_stage1.context = [
        SystemMessage(
            content=gen_stage_system_prompt(
                instance_stage1, instance_world1, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=f"""# 游戏开始！{instance_stage1.name}\n请描述当前场景叙事。""",
            kickoff=True,
        ),
        AIMessage(content=str(instance_stage1.narrative), kickoff=True),
    ]

    # 加斯科因
    instance_actor1.context = [
        SystemMessage(
            content=gen_actor_system_prompt(
                instance_actor1, instance_world1, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=gen_actor_kickoff_prompt(
                actor_name=instance_actor1.name,
                stage_name=instance_stage1.name,
                narrative=instance_stage1.narrative,
            ),
            kickoff=True,
        ),
        AIMessage(
            content=f"我是{instance_actor1.name}。我在 {instance_stage1.name} 中央，靠近天使雕像的位置，正在来回踱步。我的目标是 杀死任何闯入者！毫不犹豫，直接发起攻击！",
            kickoff=True,
        ),
    ]

    instance_actor1.attributes.health = 5

    # 艾琳
    instance_actor2.context = [
        SystemMessage(
            content=gen_actor_system_prompt(
                instance_actor2, instance_world1, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=gen_actor_kickoff_prompt(
                actor_name=instance_actor2.name,
                stage_name=instance_stage1.name,
                narrative=instance_stage1.narrative,
            ),
            kickoff=True,
        ),
        AIMessage(
            content=f"我是{instance_actor2.name}。我在 {instance_stage1.name} 东侧，黑色铁门旁的墓碑阴影中，处于隐藏状态观察着目标。我的目标是 狩猎 {instance_actor1.name}！因为斯科因已经兽化，所以必须消灭他。我决定要马上出手一击必杀！",
            kickoff=True,
        ),
    ]

    instance_actor2.attributes.attack = 50
    instance_actor2.effects.append(
        Effect(
            name="暗影突袭",
            description="从隐藏状态脱离时，第一次攻击威力提升200%。触发后效果消失。",
        )
    )

    # 外乡人
    instance_actor3.context = [
        SystemMessage(
            content=gen_actor_system_prompt(
                instance_actor3, instance_world1, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=gen_actor_kickoff_prompt(
                actor_name=instance_actor3.name,
                stage_name=instance_stage1.name,
                narrative=instance_stage1.narrative,
            ),
            kickoff=True,
        ),
        AIMessage(
            content=f"我是{instance_actor3.name}。我在  {instance_stage1.name} 南侧入口内部约10米处，刚刚进入墓地。我的目标是 探索这里的秘密并自保，尽量回避危险，必要时可以反击！",
            kickoff=True,
        ),
    ]

    # 最终拼接！
    instance_stage1.actors = [instance_actor1, instance_actor2, instance_actor3]
    instance_world1.stages = [instance_stage1]
    return instance_world1

from .models import World, Effect
from .templates import (
    template_actor1,
    template_actor2,
    template_actor3,
    template_stage1,
    template_world1,
)
import copy
from langchain.schema import HumanMessage, AIMessage

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

    # 单独设置加斯科因 #########################
    instance_actor1.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content="我是加斯科因。我在 奥顿教堂墓地。我的目标是 杀死任何闯入者！毫不犹豫，直接发起攻击！"
        ),
    ]

    instance_actor1.attributes.health = 5
    #########################

    # 单独设置艾琳 #########################
    instance_actor2.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content="我是艾琳。我在 奥顿教堂墓地。我的目标是 狩猎 加斯科因！因为斯科因已经兽化，所以必须消灭他。我决定要马上出手一击必杀！"
        ),
    ]

    instance_actor2.attributes.attack = 50
    instance_actor2.effects.append(
        Effect(
            name="暗影突袭",
            description="从隐藏状态脱离时，第一次攻击威力提升200%。触发后效果消失。",
        )
    )
    #########################

    # 单独设置外乡人 #########################
    instance_actor3.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content="我是外乡人。我在 奥顿教堂墓地。我的目标是 探索这里的秘密并自保，尽量回避危险，必要时可以反击！"
        ),
    ]

    #########################

    instance_stage1.actors = [instance_actor1, instance_actor2, instance_actor3]

    # 设置场景叙事
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。
**加斯科因**: 手中的猎人斧随着他沉重的步伐不时触碰地面，发出金属摩擦的刺耳声响。他时而仰望血月，时而低头凝视地面，像一头困在笼中的野兽，理智与疯狂在他体内激烈交战。
**艾琳**: 乌鸦羽毛斗篷与夜色完全融为一体，无法被其他人察觉。她如同死神般静立，一动不动地观察着墓地内的一切，尤其是她的猎物——加斯科因。
**外乡人**: 环顾四周，试图弄清楚自己身处何地以及接下来该做什么。这座被诅咒的城市对他来说充满了未知与危险。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**加斯科因**: 墓地中央，靠近天使雕像 | 来回踱步 | 手持猎人斧
**艾琳**: 墓地东侧，黑色铁门旁的墓碑阴影中 | 隐藏状态 | 保持静止观察
**外乡人**: 墓地南侧入口，距铁栅栏门约10米 | 站立 | 环顾四周"""

    instance_world1.stages = [instance_stage1]

    return instance_world1

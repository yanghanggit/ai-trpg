"""
多角色战斗与场景切换综合测试世界配置模块

本模块提供综合测试世界创建函数，结合了多角色战斗系统与场景移动机制。
继承world1的3角色战斗配置，并附加world2的场景2（教堂大厅）与可通行的connections。

测试场景:
- create_test_world3: 多角色战斗 + 场景切换综合测试

设计理念:
验证在复杂战斗环境下，角色是否能够：
1. 根据战斗局势判断是否需要撤退/逃离
2. 正确理解connections字段的通行条件
3. 在多角色互动中做出场景切换决策
4. 追击/逃脱等跨场景战术行为
"""

from .models import World, Effect
from .templates import (
    template_actor1,
    template_actor2,
    template_actor3,
    template_stage1,
    template_stage2,
    template_world1,
)
import copy
from langchain.schema import HumanMessage, AIMessage

# ============================================================================
# 游戏世界实例创建函数
# ============================================================================


def create_test_world3() -> World:
    """创建测试世界3 - 多角色战斗与场景切换综合测试

    此测试世界结合了world1的多角色战斗配置与world2的场景切换机制，核心设计思路：

    **测试目标**:
    1. 验证角色在战斗压力下是否会选择逃离（场景切换）
    2. 验证追击者是否会跟随目标进行跨场景追击
    3. 综合测试战斗系统与场景移动系统的协同工作

    **场景配置**:
    - 场景1（奥顿教堂墓地）：3个角色的战斗舞台
      * 加斯科因：兽化状态，攻击闯入者（血量5）
      * 艾琳：隐藏状态，准备狩猎加斯科因（攻击50 + 暗影突袭效果）
      * 外乡人：探索自保，可能成为战斗卷入者

    - 场景2（奥顿教堂大厅）：初始空场景，作为潜在的逃生/探索目标
      * 连通性：墓地->大厅可通行（侧门虚掩）
      * 战术价值：外乡人的逃生路线，或艾琳/加斯科因的追击目标

    **设计原则**:
    1. 叙事层：保持world1的紧张战斗氛围，同时暗示教堂侧门的存在
    2. 机制层：connections设置为可通行，允许角色自由移动
    3. 角色动机：保持world1的原始目标，不强制引导进入教堂

    **预期行为**:
    1. 战斗爆发：加斯科因 vs 艾琳，外乡人卷入
    2. 外乡人可能选择：
       - 逃入教堂大厅（调用move_actor_to_stage）
       - 留在墓地应战
    3. 追击场景：
       - 如果外乡人逃入教堂，加斯科因/艾琳可能追击
       - 验证跨场景战斗连续性

    Returns:
        World: 配置好的测试世界实例，包含2个场景和3个角色
    """

    # 深拷贝角色和场景，避免修改原始定义
    instance_actor1 = copy.deepcopy(template_actor1)
    instance_actor2 = copy.deepcopy(template_actor2)
    instance_actor3 = copy.deepcopy(template_actor3)
    # 深拷贝场景，避免修改原始定义
    instance_stage1 = copy.deepcopy(template_stage1)
    instance_stage2 = copy.deepcopy(template_stage2)
    # 深拷贝世界，避免修改原始定义
    instance_world3 = copy.deepcopy(template_world1)

    # 单独设置加斯科因 #########################
    instance_actor1.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content=f"我是{instance_actor1.name}。我在 奥顿教堂墓地中央，靠近天使雕像的位置，正在来回踱步。我的目标是 杀死任何闯入者！毫不犹豫，直接发起攻击！"
        ),
    ]

    instance_actor1.attributes.health = 5
    #########################

    # 单独设置艾琳 #########################
    instance_actor2.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content=f"我是{instance_actor2.name}。我在 奥顿教堂墓地东侧，黑色铁门旁的墓碑阴影中，处于隐藏状态观察着目标。我的目标是 狩猎 {instance_actor1.name}！因为斯科因已经兽化，所以必须消灭他。我决定要马上出手一击必杀！"
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
            content=f"我是{instance_actor3.name}。我在 奥顿教堂墓地南侧入口内部约10米处，刚刚进入墓地。我注意到墓地西侧有石阶通向教堂侧门，门后应该就是{instance_stage2.name}。我的目标是 探索这里的秘密并自保，尽量回避危险，必要时可以反击。如果情况危险，我可以尝试前往西侧的教堂侧门寻求庇护。"
        ),
    ]

    #########################

    # 配置场景1：奥顿教堂墓地 #########################
    instance_stage1.actors = [instance_actor1, instance_actor2, instance_actor3]

    # 设置场景叙事（在world1基础上增加教堂侧门的描述）
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。
**{instance_actor1.name}**: 手中的猎人斧随着他沉重的步伐不时触碰地面，发出金属摩擦的刺耳声响。他时而仰望血月，时而低头凝视地面，像一头困在笼中的野兽，理智与疯狂在他体内激烈交战。
**{instance_actor2.name}**: 乌鸦羽毛斗篷与夜色完全融为一体，无法被其他人察觉。她如同死神般静立，一动不动地观察着墓地内的一切，尤其是她的猎物——{instance_actor1.name}。
**{instance_actor3.name}**: 刚刚穿过铁栅栏门进入墓地南侧入口内部约10米处，环顾四周，试图弄清楚接下来该做什么。这座被诅咒的城市对他来说充满了未知与危险。
墓地西侧的石阶通向教堂侧门，那扇门似乎虚掩着，透出微弱的光芒。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor1.name}**: 墓地中央，靠近天使雕像 | 来回踱步 | 手持猎人斧
**{instance_actor2.name}**: 墓地东侧，黑色铁门旁的墓碑阴影中 | 隐藏状态 | 保持静止观察
**{instance_actor3.name}**: 墓地南侧入口，距铁栅栏门约10米 | 站立 | 环顾四周"""

    # 设置场景连通性（从world2的create_test_world_2_2继承可通行配置）
    stage_connections = f"""{instance_stage1.name} -> {instance_stage2.name}: 通过西侧石阶的教堂侧门连接
教堂侧门虚掩着，可以推开进入{instance_stage2.name}。"""
    instance_stage1.connections = stage_connections

    #########################

    # 配置场景2：奥顿教堂大厅（从world2的create_test_world_2_2继承）#########################
    instance_stage2.actors = []  # 初始时无角色，等待角色从墓地进入

    # 设置场景叙事
    instance_stage2.narrative = """教堂内空无一人，只有祭坛前的圣火发出微弱的光芒。彩色玻璃窗在血月照射下映出诡异的光影，整个大厅笼罩在一种神圣与恐怖交织的氛围中。
教堂大厅保持着诡异的宁静，石柱间的阴影似乎在缓慢蠕动。祭坛上的银十字架反射着圣火的光芒，忏悔室的木门微微晃动，仿佛有什么东西在里面。入口方向传来门外的风声，那扇虚掩的侧门轻轻摇晃。右侧档案室的铁门关闭，符文锁散发着微弱的蓝光。后方通往钟楼的螺旋楼梯传来阵阵冷风。"""

    # 设置角色状态（初始为空，角色进入后会更新）
    instance_stage2.actor_states = ""

    # 设置场景连通性（与墓地使用相同的连通性描述）
    instance_stage2.connections = stage_connections

    #########################

    instance_world3.stages = [instance_stage1, instance_stage2]

    return instance_world3

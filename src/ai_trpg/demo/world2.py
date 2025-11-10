from .models import World
from .templates import (
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


def create_test_world2() -> World:

    # 深拷贝角色和场景，避免修改原始定义
    instance_actor3 = copy.deepcopy(template_actor3)
    # 深拷贝场景，避免修改原始定义
    instance_stage1 = copy.deepcopy(template_stage1)
    instance_stage2 = copy.deepcopy(template_stage2)
    # 深拷贝世界，避免修改原始定义
    instance_world2 = copy.deepcopy(template_world1)

    # 单独设置外乡人 #########################
    instance_actor3.initial_context = [
        HumanMessage(content="""# 游戏开始！你是谁？你在哪里？你的目标是什么？"""),
        AIMessage(
            content=f"我是{instance_actor3.name}。我在 奥顿教堂墓地的西侧石阶上，站在教堂侧门门口。我的目标是 进入教堂寻找关于这座城市的真相，尤其是教会档案室中可能隐藏的秘密文献。我已经穿过了墓地，现在准备推开这扇半掩的侧门进入教堂。"
        ),
    ]
    #########################

    # 配置场景1：奥顿教堂墓地 #########################
    instance_stage1.actors = [instance_actor3]

    # 设置场景叙事
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。墓碑间静谧无声，偶尔传来远处的兽吼。
**{instance_actor3.name}**: 已经穿过了墓地，小心翼翼地站在西侧石阶顶端的教堂侧门前，手持油灯。这扇半掩的木门后就是教堂内部。他回望身后，墓地中央的天使雕像在血月下投射出扭曲的阴影。他深吸一口气，伸手按在门上，准备推门进入教堂寻找档案室的秘密。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor3.name}**: 墓地西侧石阶顶端，教堂侧门门口 | 准备推门进入 | 左手持油灯，右手按在门上"""

    #########################

    # 配置场景2：奥顿教堂大厅 #########################
    instance_stage2.actors = []  # 初始时外乡人不在教堂内，需要从墓地进入

    # 设置场景叙事
    instance_stage2.narrative = """教堂内空无一人，只有祭坛前的圣火发出微弱的光芒。彩色玻璃窗在血月照射下映出诡异的光影，整个大厅笼罩在一种神圣与恐怖交织的氛围中。
教堂大厅保持着诡异的宁静，石柱间的阴影似乎在缓慢蠕动。祭坛上的银十字架反射着圣火的光芒，忏悔室的木门微微晃动，仿佛有什么东西在里面。右侧档案室的铁门紧锁，符文锁散发着微弱的蓝光。后方通往钟楼的螺旋楼梯传来阵阵冷风。"""

    # 设置角色状态（初始为空，外乡人进入后会更新）
    instance_stage2.actor_states = ""

    #########################

    instance_world2.stages = [instance_stage1, instance_stage2]

    return instance_world2

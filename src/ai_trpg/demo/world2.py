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


def create_test_world_2_1() -> World:
    """创建测试世界2.1 - 场景连通性约束测试

    此测试世界用于验证场景间移动的连通性约束机制，核心设计思路：

    **测试目标**:
    验证LLM能否正确理解connections字段中的机制性约束（如"锁死""需要钥匙"），
    并在缺少满足条件的情况下，拒绝调用move_actor_to_stage工具。

    **设计原则 - 信息分层**:
    1. 叙事层（narrative/actor_states/initial_context）：
       - 仅描述物理状态（"关闭的门""紧闭"）
       - 不透露机制性约束（不提"锁死""钥匙"）
       - 角色使用"尝试"表达意图，不预设结果

    2. 机制层（connections）：
       - 明确说明通行条件（"已经被锁死，必须找到钥匙才能进入"）
       - LLM必须参考此字段判断行动可行性
       - 这是唯一的约束性信息来源

    **场景配置**:
    - 场景1（奥顿教堂墓地）：外乡人初始位置，站在锁死的侧门前
    - 场景2（奥顿教堂大厅）：目标场景，初始无角色
    - 连通性：墓地->大厅需要钥匙（当前Item系统未实现，条件无法满足）

    **预期行为**:
    1. 外乡人计划"尝试推门进入教堂"
    2. LLM分析connections发现"已经被锁死，必须找到钥匙"
    3. LLM判断条件不满足（无钥匙），不调用move_actor_to_stage工具
    4. 叙事描述推门失败，connections保持原值不变
    5. 角色留在墓地场景，位置/姿态更新为"检查门锁"状态

    Returns:
        World: 配置好的测试世界实例，包含2个场景和1个角色
    """

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
            content=f"我是{instance_actor3.name}。我在 奥顿教堂墓地的西侧石阶上，站在教堂侧门门口。我的目标是 进入教堂寻找关于这座城市的真相，尤其是教会档案室中可能隐藏的秘密文献。我已经穿过了墓地，现在准备尝试推开这个关闭的门。"
        ),
    ]
    #########################

    # 配置场景1：奥顿教堂墓地 #########################
    instance_stage1.actors = [instance_actor3]

    # 设置场景叙事
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。墓碑间静谧无声，偶尔传来远处的兽吼。
**{instance_actor3.name}**: 已经穿过了墓地，小心翼翼地站在西侧石阶顶端的教堂侧门前，手持油灯。这扇关闭的门后就是教堂内部。他回望身后，墓地中央的天使雕像在血月下投射出扭曲的阴影。他深吸一口气，伸手按在门上，准备尝试推开。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor3.name}**: 墓地西侧石阶顶端，教堂侧门门口 | 准备尝试推门 | 左手持油灯，右手按在门上"""

    # 设置场景连通性（两个场景使用统一的连通性描述）
    stage_connections = """奥顿教堂墓地 -> 奥顿教堂大厅: 通过西侧石阶的教堂侧门连接
目前教堂侧门已经被锁死，必须找到钥匙才能进入教堂大厅。"""
    instance_stage1.connections = stage_connections

    #########################

    # 配置场景2：奥顿教堂大厅 #########################
    instance_stage2.actors = []  # 初始时外乡人不在教堂内，需要从墓地进入

    # 设置场景叙事
    instance_stage2.narrative = """教堂内空无一人，只有祭坛前的圣火发出微弱的光芒。彩色玻璃窗在血月照射下映出诡异的光影，整个大厅笼罩在一种神圣与恐怖交织的氛围中。
教堂大厅保持着诡异的宁静，石柱间的阴影似乎在缓慢蠕动。祭坛上的银十字架反射着圣火的光芒，忏悔室的木门微微晃动，仿佛有什么东西在里面。入口方向传来门外的风声，那扇关闭的侧门依然紧闭。右侧档案室的铁门关闭，符文锁散发着微弱的蓝光。后方通往钟楼的螺旋楼梯传来阵阵冷风。"""

    # 设置角色状态（初始为空，外乡人进入后会更新）
    instance_stage2.actor_states = ""

    # 设置场景连通性（与墓地使用相同的连通性描述）
    instance_stage2.connections = stage_connections

    #########################

    instance_world2.stages = [instance_stage1, instance_stage2]

    return instance_world2

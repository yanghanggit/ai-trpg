"""
场景间移动测试世界配置模块

本模块提供用于测试Actor在Stage之间移动功能的测试世界创建函数。
主要验证LLM代理能否正确理解场景连通性约束（connections字段），
并根据约束条件决定是否调用move_actor_to_stage工具。

测试场景:
- create_test_world_2_1: 不可通行测试（门被锁死，需要钥匙）
- create_test_world_2_2: 可通行测试（门虚掩，可以推开）

设计理念:
通过信息分层（叙事层 vs 机制层）验证LLM是否能从connections字段
读取约束条件，而非仅根据角色意图就执行移动操作。
"""

from .models import World
from .templates import (
    template_actor3,
    template_stage1,
    template_stage2,
    template_world1,
)
import copy
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
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

    # 创建世界
    instance_world2.name = f"""{instance_world2.name}_2_1"""
    instance_world2.context = [
        SystemMessage(
            content=gen_world_system_prompt(instance_world2, GLOBAL_GAME_MECHANICS)
        )
    ]

    # 设置场景连通性（两个场景使用统一的连通性描述）
    stage_connections = f"""{instance_stage1.name} -> {instance_stage2.name}: 通过西侧石阶的教堂侧门连接
目前教堂侧门已经被锁死，必须找到钥匙才能进入{instance_stage2.name}。"""

    # 配置场景1：奥顿教堂墓地
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。墓碑间静谧无声，偶尔传来远处的兽吼。
**{instance_actor3.name}**: 已经穿过了墓地，小心翼翼地站在西侧石阶顶端的教堂侧门前，手持油灯。这扇关闭的门后就是教堂内部。他回望身后，墓地中央的天使雕像在血月下投射出扭曲的阴影。他深吸一口气，伸手按在门上，准备尝试推开。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor3.name}**: 墓地西侧石阶顶端，教堂侧门门口 | 准备尝试推门 | 左手持油灯，右手按在门上"""

    # 设置场景连通性
    instance_stage1.connections = stage_connections

    # 填充 stage_connections 列表（准备图数据结构）
    instance_stage1.stage_connections = [instance_stage2.name]

    # 设置上下文！
    instance_stage1.context = [
        SystemMessage(
            content=gen_stage_system_prompt(
                instance_stage1, instance_world2, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=f"""# 游戏开始！{instance_stage1.name}\n请描述当前场景叙事。""",
            kickoff=True,
        ),
        AIMessage(content=str(instance_stage1.narrative), kickoff=True),
    ]

    # 配置场景2：奥顿教堂大厅
    instance_stage2.narrative = """教堂内空无一人，只有祭坛前的圣火发出微弱的光芒。彩色玻璃窗在血月照射下映出诡异的光影，整个大厅笼罩在一种神圣与恐怖交织的氛围中。
教堂大厅保持着诡异的宁静，石柱间的阴影似乎在缓慢蠕动。祭坛上的银十字架反射着圣火的光芒，忏悔室的木门微微晃动，仿佛有什么东西在里面。入口方向传来门外的风声，那扇关闭的侧门依然紧闭。右侧档案室的铁门关闭，符文锁散发着微弱的蓝光。后方通往钟楼的螺旋楼梯传来阵阵冷风。"""

    # 设置角色状态（初始为空，外乡人进入后会更新）
    instance_stage2.actor_states = ""

    # 设置场景连通性
    instance_stage2.connections = stage_connections

    # 填充 stage_connections 列表（准备图数据结构）
    instance_stage2.stage_connections = [instance_stage1.name]

    # 设置上下文！
    instance_stage2.context = [
        SystemMessage(
            content=gen_stage_system_prompt(
                instance_stage2, instance_world2, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=f"""# 游戏开始！{instance_stage2.name}\n请描述当前场景叙事。""",
            kickoff=True,
        ),
        AIMessage(content=str(instance_stage2.narrative), kickoff=True),
    ]

    # 外乡人
    instance_actor3.context = [
        SystemMessage(
            content=gen_actor_system_prompt(
                instance_actor3, instance_world2, GLOBAL_GAME_MECHANICS
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
            content=f"我是{instance_actor3.name}。我在 {instance_stage1.name}的西侧石阶上，站在教堂侧门门口。我的目标是 进入教堂寻找关于这座城市的真相，尤其是教会档案室中可能隐藏的秘密文献。我已经穿过了墓地，现在准备尝试推开这个关闭的门。",
            kickoff=True,
        ),
    ]

    # 最终拼接！
    instance_stage1.actors = [instance_actor3]
    instance_stage2.actors = []
    instance_world2.stages = [instance_stage1, instance_stage2]

    return instance_world2


def create_test_world_2_2() -> World:
    """创建测试世界2.2 - 场景连通性可通行测试

    此测试世界用于验证场景间移动的连通性机制在**条件满足**时的正常流程，核心设计思路：

    **测试目标**:
    验证LLM能否正确理解connections字段中的可通行状态，
    并在条件满足的情况下，正确调用move_actor_to_stage工具完成场景切换。

    **设计原则 - 信息分层**:
    1. 叙事层（narrative/actor_states/initial_context）：
       - 描述物理状态（"虚掩的门""可以推开"）
       - 角色使用"尝试"表达意图，但门是可以打开的

    2. 机制层（connections）：
       - 明确说明通行条件（"侧门虚掩着，可以推开进入"）
       - LLM必须参考此字段判断行动可行性
       - 这是唯一的约束性信息来源

    **场景配置**:
    - 场景1（奥顿教堂墓地）：外乡人初始位置，站在虚掩的侧门前
    - 场景2（奥顿教堂大厅）：目标场景，初始无角色
    - 连通性：墓地->大厅可以通过（侧门虚掩，可以推开）

    **预期行为**:
    1. 外乡人计划"尝试推门进入教堂"
    2. LLM分析connections发现"侧门虚掩着，可以推开进入"
    3. LLM判断条件满足（门可以打开），调用move_actor_to_stage工具
    4. 叙事描述推门成功，角色进入教堂大厅
    5. connections保持原值不变
    6. 角色从墓地场景移动到教堂大厅场景，位置/姿态更新为"刚进入大厅"状态

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

    # 创建世界
    instance_world2.name = f"""{instance_world2.name}_2_2"""
    instance_world2.context = [
        SystemMessage(
            content=gen_world_system_prompt(instance_world2, GLOBAL_GAME_MECHANICS)
        )
    ]

    # 设置场景连通性（两个场景使用统一的连通性描述）- 关键修改：门可以推开
    stage_connections = f"""{instance_stage1.name} -> {instance_stage2.name}: 通过西侧石阶的教堂侧门连接
教堂侧门虚掩着，可以推开进入{instance_stage2.name}。"""

    # 配置场景1：奥顿教堂墓地
    instance_stage1.narrative = f"""血月高悬，墓地笼罩在诡异的暗红色雾气中。墓碑间静谧无声，偶尔传来远处的兽吼。
**{instance_actor3.name}**: 已经穿过了墓地，现在站在西侧石阶顶端的教堂侧门前，手持油灯。这扇虚掩的门后就是他要去的{instance_stage2.name}。他目光坚定，已经下定决心——必须立刻推开这扇门，进入教堂内部探索。他伸手用力按在门上，准备用力推开它，毫不犹豫地跨入{instance_stage2.name}。"""

    # 设置角色状态
    instance_stage1.actor_states = f"""**{instance_actor3.name}**: 墓地西侧石阶顶端，教堂侧门门口 | 正准备推门进入{instance_stage2.name} | 左手持油灯，右手用力按在门上，身体前倾准备跨入"""

    # 设置场景连通性
    instance_stage1.connections = stage_connections

    # 填充 stage_connections 列表（准备图数据结构）
    instance_stage1.stage_connections = [instance_stage2.name]

    # 设置上下文！
    instance_stage1.context = [
        SystemMessage(
            content=gen_stage_system_prompt(
                instance_stage1, instance_world2, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=f"""# 游戏开始！{instance_stage1.name}\n请描述当前场景叙事。""",
            kickoff=True,
        ),
        AIMessage(content=str(instance_stage1.narrative), kickoff=True),
    ]

    # 配置场景2：奥顿教堂大厅
    instance_stage2.narrative = """教堂内空无一人，只有祭坛前的圣火发出微弱的光芒。彩色玻璃窗在血月照射下映出诡异的光影，整个大厅笼罩在一种神圣与恐怖交织的氛围中。
教堂大厅保持着诡异的宁静，石柱间的阴影似乎在缓慢蠕动。祭坛上的银十字架反射着圣火的光芒，忏悔室的木门微微晃动，仿佛有什么东西在里面。入口方向传来门外的风声，那扇虚掩的侧门轻轻摇晃。右侧档案室的铁门关闭，符文锁散发着微弱的蓝光。后方通往钟楼的螺旋楼梯传来阵阵冷风。"""

    # 设置角色状态（初始为空，外乡人进入后会更新）
    instance_stage2.actor_states = ""

    # 设置场景连通性
    instance_stage2.connections = stage_connections

    # 填充 stage_connections 列表（准备图数据结构）
    instance_stage2.stage_connections = [instance_stage1.name]

    # 设置上下文！
    instance_stage2.context = [
        SystemMessage(
            content=gen_stage_system_prompt(
                instance_stage2, instance_world2, GLOBAL_GAME_MECHANICS
            )
        ),
        HumanMessage(
            content=f"""# 游戏开始！{instance_stage2.name}\n请描述当前场景叙事。""",
            kickoff=True,
        ),
        AIMessage(content=str(instance_stage2.narrative), kickoff=True),
    ]

    # 外乡人
    instance_actor3.context = [
        SystemMessage(
            content=gen_actor_system_prompt(
                instance_actor3, instance_world2, GLOBAL_GAME_MECHANICS
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
            content=f"我是{instance_actor3.name}。我在 {instance_stage1.name}的西侧石阶上，站在教堂侧门门口。我的目标是 **立即进入{instance_stage2.name}**，寻找关于这座城市的真相，尤其是教会档案室中可能隐藏的秘密文献。我已经穿过了墓地，现在**必须马上推开这扇虚掩的门，进入教堂内部**。这是我此刻唯一且最紧迫的行动目标。",
            kickoff=True,
        ),
    ]

    # 最终拼接！
    instance_stage1.actors = [instance_actor3]
    instance_stage2.actors = []
    instance_world2.stages = [instance_stage1, instance_stage2]

    return instance_world2

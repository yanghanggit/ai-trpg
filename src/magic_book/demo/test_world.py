from pydantic import BaseModel
from typing import List, Final


# ============================================================================
# 游戏数据字典
# ============================================================================


# character_profile
class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str
    character_profile: str
    appearance: str


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str
    description: str
    environment: str
    actors: List[Actor]
    stages: List["Stage"] = []  # 支持嵌套子场景

    def find_actor(self, actor_name: str) -> Actor | None:
        """递归查找指定名称的Actor

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            找到的Actor对象，如果未找到则返回None
        """
        # 在当前场景的actors中查找
        for actor in self.actors:
            if actor.name == actor_name:
                return actor

        # 递归搜索子场景中的actors
        for stage in self.stages:
            found = stage.find_actor(actor_name)
            if found:
                return found

        return None


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str
    description: str
    stages: List[Stage]

    def find_stage(self, stage_name: str) -> Stage | None:
        """递归查找指定名称的Stage

        Args:
            stage_name: 要查找的Stage名称

        Returns:
            找到的Stage对象，如果未找到则返回None
        """

        def _recursive_find(stages: List[Stage], target_name: str) -> Stage | None:
            for stage in stages:
                if stage.name == target_name:
                    return stage
                # 递归搜索子场景
                if stage.stages:
                    found = _recursive_find(stage.stages, target_name)
                    if found:
                        return found
            return None

        return _recursive_find(self.stages, stage_name)

    def find_actor_with_stage(
        self, actor_name: str
    ) -> tuple[Actor | None, Stage | None]:
        """查找指定名称的Actor及其所在的Stage

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            (Actor, Stage)元组,如果未找到则返回(None, None)
        """

        def _recursive_search(
            stages: List[Stage],
        ) -> tuple[Actor | None, Stage | None]:
            for stage in stages:
                # 先在当前Stage的actors中直接查找
                for actor in stage.actors:
                    if actor.name == actor_name:
                        return actor, stage

                # 递归搜索子场景
                if stage.stages:
                    found_actor, found_stage = _recursive_search(stage.stages)
                    if found_actor and found_stage:
                        return found_actor, found_stage

            return None, None

        return _recursive_search(self.stages)

    def get_all_actors(self) -> List[Actor]:
        """遍历获取世界中所有的Actor

        Returns:
            包含世界中所有Actor的列表
        """
        all_actors: List[Actor] = []

        def _collect_actors(stages: List[Stage]) -> None:
            for stage in stages:
                # 收集当前Stage中的所有actors
                all_actors.extend(stage.actors)
                # 递归收集子场景中的actors
                if stage.stages:
                    _collect_actors(stage.stages)

        _collect_actors(self.stages)
        return all_actors

    def get_all_stages(self) -> List[Stage]:
        """遍历获取世界中所有的Stage

        Returns:
            包含世界中所有Stage的列表
        """
        all_stages: List[Stage] = []

        def _collect_stages(stages: List[Stage]) -> None:
            for stage in stages:
                # 收集当前Stage
                all_stages.append(stage)
                # 递归收集子场景
                if stage.stages:
                    _collect_stages(stage.stages)

        _collect_stages(self.stages)
        return all_stages


# ============================================================================
# 游戏世界实例
# ============================================================================

test_world: Final[World] = World(
    name="艾泽拉斯大陆",
    description="一个充满魔法与冒险的奇幻世界，古老的传说在这里流传，英雄们在这片土地上书写着自己的史诗。",
    stages=[
        # 月光林地（直接作为World的Stage）
        Stage(
            name="月光林地",
            description="艾泽拉斯大陆北部的神秘林地，这片林地在夜晚会被月光笼罩，显得格外宁静祥和。古老的石碑矗立在林地中央，通往南边的星语圣树。",
            environment="银色的月光透过树叶间隙洒落，照亮了布满青苔的石板路。四周是参天的古树，偶尔能听到夜莺的歌声。一条蜿蜒的小路向南延伸，连接着森林深处。",
            actors=[],
        ),
        # 星语圣树（直接作为World的Stage）
        Stage(
            name="星语圣树",
            description="艾泽拉斯大陆的核心圣地，一棵巨大的生命古树屹立于此，这是德鲁伊们的圣地。从北边的月光林地可以直接到达这里。",
            environment="一棵高耸入云的巨大古树占据了视野中心，树干粗壮到需要数十人才能环抱。树根盘绕形成天然的平台，树冠上挂满发光的藤蔓和花朵。空气中充满了浓郁的生命能量。",
            actors=[
                Actor(
                    name="艾尔温·星语",
                    character_profile="精灵族的德鲁伊长老，他精通自然魔法，能与森林中的生物沟通。",
                    appearance="身穿绿色长袍的高大精灵，银白色的长发及腰，碧绿的眼眸中闪烁着智慧的光芒，手持一根雕刻着古老符文的木杖",
                ),
                Actor(
                    name="索尔娜·影舞",
                    character_profile="神秘的暗夜精灵游侠，是森林的守护者。她在区域间穿梭巡逻，行踪飘忽，箭术精湛，总是在危险来临前出现。",
                    appearance="身着深紫色皮甲的矫健身影,紫色的肌肤在月光下闪耀,银色的长发束成高马尾,背后背着一把精致的月牙弓和装满银色羽箭的箭筒",
                ),
            ],
        ),
    ],
)


## 游戏规则
# - 世界构成：只有一个World, 而 World 包含多个 Stage，每个 Stage 包含多个 Actor 和 子Stages。
# - 核心规则：Actor 必须所在某个 Stage 中。在 Stage 中，Actor 可以与其他 Actor 互动。


########################################################################################################################
def gen_admin_system_message(world: World) -> str:
    return f"""# 游戏管理员

你负责管理和维护游戏世界的秩序与运行，你是游戏的最高管理者。

## 游戏世界

名称: {world.name}
描述: {world.description}

## 你的职责：
- 你需要根据玩家的指令，管理游戏世界的状态。
- 你可以添加、删除或修改 Actor 和 Stage。
- 你需要确保游戏世界的逻辑一致性和规则遵守。
- 你需要根据玩家的指令，提供游戏世界的最新状态信息。"""


########################################################################################################################
def gen_actor_system_message(actor_model: Actor, world: World) -> str:
    return f"""# {actor_model.name}

你扮演这个游戏世界的一个角色：{actor_model.name} 

## 人物设定：

{actor_model.character_profile}

## 外观信息

{actor_model.appearance}

## 世界设定

名称: {world.name}
描述: {world.description}

## 你的职责：
- 你需要根据你的角色设定，做出符合角色身份的回应。
- 你可以与其他角色互动，探索场景，完成任务。
- 你的回应应当推动故事发展，增加游戏的趣味性和沉浸感。"""


########################################################################################################################
def gen_stage_system_message(stage_model: Stage, world: World) -> str:
    return f"""# 场景: {stage_model.name}

你扮演这个游戏世界的一个场景: {stage_model.name}

## 场景描述：

{stage_model.description}

## 场景环境描写

{stage_model.environment}

## 世界设定

名称: {world.name}
描述: {world.description}

## 你的职责：
- 你需要根据你的场景设定，描述场景中的环境和氛围。
- 你可以描述场景中的角色互动，事件发生等。
- 你的描述应当推动故事发展，增加游戏的趣味性和沉浸感。"""

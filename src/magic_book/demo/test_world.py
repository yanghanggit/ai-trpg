from pydantic import BaseModel
from typing import List, Final


# ============================================================================
# 游戏数据字典
# ============================================================================

## 游戏规则
# - 世界构成：只有一个World, 而 World 包含多个 Stage，每个 Stage 包含多个 Actor 和 子Stages。
# - 核心规则：Actor 必须所在某个 Stage 中。在 Stage 中，Actor 可以与其他 Actor 互动。


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str  # 角色名称
    profile: str  # 角色档案/设定
    appearance: str  # 外观描述


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str  # 场景名称
    narrative: str  # 叙事描述（故事层面）
    environment: str  # 环境描写（感官层面）
    actors: List[Actor]  # 场景中的角色
    sub_stages: List["Stage"] = []  # 子场景

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
        for stage in self.sub_stages:
            found = stage.find_actor(actor_name)
            if found:
                return found

        return None


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str
    campaign_setting: str
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
                if stage.sub_stages:
                    found = _recursive_find(stage.sub_stages, target_name)
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
                if stage.sub_stages:
                    found_actor, found_stage = _recursive_search(stage.sub_stages)
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
                if stage.sub_stages:
                    _collect_actors(stage.sub_stages)

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
                if stage.sub_stages:
                    _collect_stages(stage.sub_stages)

        _collect_stages(self.stages)
        return all_stages


# ============================================================================
# 游戏世界实例
# ============================================================================

test_world: Final[World] = World(
    name="雅南诅咒之夜",
    campaign_setting="一座被兽疫诅咒笼罩的维多利亚式古城，血月高悬，兽性在人心中蔓延。教会的狩猎之夜永无止境，古老的血脉秘密埋藏在哥特式教堂的地底深处。",
    stages=[
        # 雅南古城教堂区
        Stage(
            name="雅南古城教堂区",
            narrative="雅南古城的核心地带，高耸的哥特式教堂矗立在血雾弥漫的广场上。这里曾是治愈教会的圣地，如今却成为了兽化病患的墓场。石质尖塔刺破猩红的血月，教堂的钟声在夜空中回荡，仿佛在为死者祈祷。",
            environment="破败的维多利亚式建筑群在血月的照耀下投下扭曲的阴影。鹅卵石铺就的广场上散落着被遗弃的轮椅和医疗器械，干涸的血迹在地面上形成诡异的图案。教堂的彩色玻璃窗透出昏暗的烛光，铁栅栏后传来低沉的嘶吼声。浓稠的血雾从街道的每个角落渗出，空气中弥漫着焚香、腐朽和铁锈的混合气味。远处偶尔传来野兽的咆哮和猎人的枪声。",
            actors=[
                Actor(
                    name="加斯科因神父",
                    profile="曾经的治愈教会神父，现在却在兽化的边缘挣扎。他是教会最优秀的猎人之一，但长期的狩猎让他逐渐失去人性。他在理智与疯狂之间徘徊，手持斧头和猎枪守卫着教堂墓地，既是守护者也是囚徒。他的灵魂深处残存着对妻女的记忆，这是他最后的人性锚点。",
                    appearance="身穿沾满血污的黑色神父长袍，外罩褴褛的灰色猎人大衣。面容憔悴苍白，凌乱的黑发下是一双布满血丝的眼睛。右手持一把巨大的猎人斧，左手拿着双管猎枪。脖子上挂着已经破碎的银制十字架。每一次呼吸都伴随着喉咙深处的低吼，身上散发着血腥和硫磺的气息。",
                ),
                Actor(
                    name="孤独的猎人艾琳",
                    profile="冷酷而神秘的乌鸦猎人，专门追猎那些被血之狂乱吞噬的堕落猎人。她是猎人队伍中的异类，独行于雅南的街道，身手敏捷，剑技精湛。她对血之契约有着深刻的理解，但从不多言。艾琳心中埋藏着对这座城市堕落的悲哀，以及对那些失去人性的同伴的怜悯。她知道许多关于上层建筑的秘密，但选择保持沉默。",
                    appearance="身着厚重的乌鸦羽毛斗篷和黑色猎装，戴着鸟喙状的瘟疫医生面具，只露出一双冰冷锐利的眼眸。腰间挂着古老的慈悲之刃，刀鞘上刻满了已故猎人的名字。皮质手套和护腕上布满了战斗的痕迹。她的动作无声而致命，如同夜色中的幽灵。斗篷下隐约可见猎人徽章和血之遗珠。",
                ),
            ],
        ),
    ],
)

# ============================================================================
# RAG 知识库测试数据
# ============================================================================
test_knowledge_base: Final[dict[str, List[str]]] = {
    "场景介绍": [
        "雅南古城教堂区是治愈教会的核心区域，高耸的哥特式尖塔直指血红色的夜空。石制建筑上雕刻着复杂的宗教图案，诉说着古老血族的秘密。",
        "教堂区的广场上散落着被遗弃的医疗器械和轮椅，这里曾是血液疗法的实验场所。墙壁上的血迹已经干涸，形成了诡异的褐色图案。",
        "教堂的地下墓穴深不可测，据说通往上层建筑和月之河。墓穴中埋葬着无数因兽疫而死的亡灵，他们的哀嚎在夜晚回荡。",
        "血月高悬时，教堂区会显现出平日里看不见的景象——巨大的上位者在空中游荡，它们的触手在建筑间蠕动，低语着令人疯狂的真理。",
        "治愈教会曾在此进行血液治疗，但随着时间推移，这些治疗反而加速了兽疫的传播。如今教堂已经成为禁区，只有最勇敢的猎人才敢踏足。",
        "教堂的钟楼上住着乌鸦群，它们被称为死亡的使者。每当有猎人死去，乌鸦就会聚集在尸体上空盘旋，发出刺耳的鸣叫。",
        "广场的中央有一口古井，井水呈现出诡异的红色。据说这口井直通地底的血之池，是上位者赐予雅南的恩惠，也是诅咒的源头。",
        "教堂区的巷道错综复杂，许多道路在血雾中若隐若现。墙壁上写满了疯狂者的涂鸦，警告着闯入者不要深入。",
        "夜晚的教堂区充满危险，兽化的病患在街道上游荡，它们曾经是普通的雅南市民，如今只剩下嗜血的本能和残破的人形。",
        "传说教堂的地底深处隐藏着古神的真相，但没有人能活着从那里回来。只有在梦境中，猎人才能窥见那不可名状的恐怖存在。",
    ],
}


########################################################################################################################
def gen_admin_system_message(world: World) -> str:
    return f"""# 游戏管理员

你负责管理和维护游戏世界的秩序与运行，你是游戏的最高管理者。

## 游戏世界

名称: {world.name}
描述: {world.campaign_setting}

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

{actor_model.profile}

## 外观信息

{actor_model.appearance}

## 世界设定

名称: {world.name}
描述: {world.campaign_setting}

## 你的职责：
- 你需要根据你的角色设定，做出符合角色身份的回应。
- 你可以与其他角色互动，探索场景，完成任务。
- 你的回应应当推动故事发展，增加游戏的趣味性和沉浸感。"""


########################################################################################################################
def gen_stage_system_message(stage_model: Stage, world: World) -> str:
    return f"""# 场景: {stage_model.name}

你扮演这个游戏世界的一个场景: {stage_model.name}

## 场景描述：

{stage_model.narrative}

## 场景环境描写

{stage_model.environment}

## 世界设定

名称: {world.name}
描述: {world.campaign_setting}

## 你的职责：
- 你需要根据你的场景设定，描述场景中的环境和氛围。
- 你可以描述场景中的角色互动，事件发生等。
- 你的描述应当推动故事发展，增加游戏的趣味性和沉浸感。"""

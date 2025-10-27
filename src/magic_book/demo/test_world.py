from pydantic import BaseModel, Field
from typing import List, Final


# ============================================================================
# 游戏数据字典
# ============================================================================

## 游戏规则
# - 世界构成：只有一个World, 而 World 包含多个 Stage，每个 Stage 包含多个 Actor 和 子Stages。
# - 核心规则：Actor 必须所在某个 Stage 中。在 Stage 中，Actor 可以与其他 Actor 互动。


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str = Field(description="角色名称")
    profile: str = Field(description="角色档案/设定")
    appearance: str = Field(description="外观描述")


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str = Field(description="场景名称")
    narrative: str = Field(description="叙事描述（故事层面）")
    environment: str = Field(description="环境描写（感官层面）")
    actors: List[Actor] = Field(description="场景中的角色")
    sub_stages: List["Stage"] = Field(default_factory=list, description="子场景")

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

    name: str = Field(description="世界名称")
    campaign_setting: str = Field(description="战役设定/世界观描述")
    stages: List[Stage] = Field(description="世界中的场景列表")

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
    name="雅南城",
    campaign_setting="一座被兽疫诅咒笼罩的维多利亚式古城，血月高悬，兽性在人心中蔓延。教会的狩猎之夜永无止境，古老的血脉秘密埋藏在哥特式教堂的地底深处。",
    stages=[
        # 奥顿教堂墓地
        Stage(
            name="奥顿教堂墓地",
            narrative="雅南古城教堂区的核心禁地——奥顿教堂的墓园。这片被铁栅栏围起的墓地是治愈教会埋葬兽化病患的圣域,如今已成为猎人的试炼场。无数墓碑在血月下静默排列,墓穴深处通往地下教堂的秘密通道。加斯科因神父便在此守卫着这片亡者的安息之地,既防止死者复生,也阻止生者闯入。",
            environment="生锈的铁栅栏门半掩着,门上挂着治愈教会的徽记。墓地内石质墓碑参差林立,有的倾斜断裂,有的被藤蔓缠绕。鹅卵石小径蜿蜒在墓碑间,路面上散落着枯萎的花束和破碎的墓志铭碎片。墓地中央矗立着一座风化的石制天使雕像,双手合十,面容哀伤。墓地边缘堆放着废弃的棺木和挖掘工具,证明这里曾频繁举行葬礼。浓稠的血雾在墓碑间流淌,月光透过雾气投下斑驳的光影。空气中弥漫着泥土、腐朽和焚香的气息,偶尔能听到来自墓穴深处的低沉回响和教堂钟楼的钟声。墓地西侧的石阶通向教堂主建筑,东侧则是通往地下墓穴的铁门。",
            actors=[
                Actor(
                    name="加斯科因",
                    profile="曾经的治愈教会神父，现在却在兽化的边缘挣扎。他是教会最优秀的猎人之一，但长期的狩猎让他逐渐失去人性。他在理智与疯狂之间徘徊，手持斧头和猎枪守卫着教堂墓地，既是守护者也是囚徒。他的灵魂深处残存着对妻女的记忆，这是他最后的人性锚点。",
                    appearance="身穿沾满血污的黑色神父长袍，外罩褴褛的灰色猎人大衣。面容憔悴苍白，凌乱的黑发下是一双布满血丝的眼睛。右手持一把巨大的猎人斧，左手拿着双管猎枪。脖子上挂着已经破碎的银制十字架。每一次呼吸都伴随着喉咙深处的低吼，身上散发着血腥和硫磺的气息。",
                ),
                Actor(
                    name="艾琳",
                    profile="冷酷而神秘的乌鸦猎人，专门追猎那些被血之狂乱吞噬的堕落猎人。她是猎人队伍中的异类，独行于雅南的街道，身手敏捷，剑技精湛。她对血之契约有着深刻的理解，但从不多言。艾琳心中埋藏着对这座城市堕落的悲哀，以及对那些失去人性的同伴的怜悯。她知道许多关于上层建筑的秘密，但选择保持沉默。",
                    appearance="身着厚重的乌鸦羽毛斗篷和黑色猎装，戴着鸟喙状的瘟疫医生面具，只露出一双冰冷锐利的眼眸。腰间挂着古老的慈悲之刃，刀鞘上刻满了已故猎人的名字。皮质手套和护腕上布满了战斗的痕迹。她的动作无声而致命，如同夜色中的幽灵。斗篷下隐约可见猎人徽章和血之遗珠。",
                ),
                Actor(
                    name="外乡人",
                    profile="一个来历不明的神秘旅行者，从遥远的异乡来到雅南城。他声称是为了寻找失落的记忆和隐藏的真相，但他的真实目的无人知晓。外乡人对雅南的历史、教会和兽疫有着异乎寻常的兴趣，似乎在追寻某个被遗忘已久的秘密。他不隶属于任何组织，也不认识这座城市的猎人们。他谨慎而好奇，对周围的一切保持着警惕的观察态度。尽管身处危险之中，他仍然坚持着自己的探索之路。",
                    appearance="身穿磨损的深灰色旅行斗篷，内衬褪色的棕色皮甲，显然经历了漫长的旅途。腰间系着一条装满杂物的皮质腰包，挂着油灯、水囊和一本破旧的笔记本。他戴着一顶宽檐帽，遮住了大部分面容，只露出深邃而疲惫的眼神。手持一根雕刻着奇异符文的木制手杖，既是行走的工具也是自卫的武器。靴子上沾满了泥土和血迹，证明他曾穿越了雅南最危险的街道。尽管装备简陋，但他身上散发出一种不屈的韧性和对未知的渴望。",
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
        "奥顿教堂墓地的东侧铁门后是深邃的地下墓穴，墓穴分为三层：上层是普通市民的墓室，中层埋葬着教会骑士，最下层则是被封印的禁区，据说那里关押着最早的兽化实验体。",
        "墓地中央的天使雕像并非装饰，而是一个机关。当血月达到最高点时，雕像会旋转打开，露出通往古老祭坛的暗道。只有持有教会钥匙的人才能激活这个机关。",
        "加斯科因神父的妻子维奥拉曾是一名普通的雅南市民，她在兽疫爆发前就已预见灾难，并留下了一个音乐盒。这个音乐盒能唤起加斯科因残存的人性记忆，暂时压制他体内的兽性。",
        "艾琳的慈悲之刃是由陨铁锻造，刀身铭刻着已故猎人的真名。传说每杀死一个堕落的猎人，刀刃上就会浮现新的名字，这是乌鸦猎人代代相传的诅咒与荣耀。",
    ],
}


########################################################################################################################
def gen_world_system_message(world: World) -> str:
    return f"""# {world.name}

你是 {world.name}，你扮演这个游戏世界的管理员。
你负责管理和维护游戏世界的秩序与运行，你是游戏的最高管理者。

## 游戏世界

名称: {world.name}（与你同名）
战役设定: {world.campaign_setting}

## 你的职责：
- 你需要根据玩家的指令，管理游戏世界的状态。
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

from pydantic import BaseModel, Field
from typing import List, Final


class StatusEffect(BaseModel):
    """表示游戏中角色状态效果的模型"""

    name: str = Field(description="状态效果名称")
    description: str = Field(description="状态效果描述")


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str = Field(description="角色名称")
    profile: str = Field(description="角色档案/设定")
    appearance: str = Field(description="外观描述")
    status_effects: List[StatusEffect] = Field(
        default_factory=list, description="角色当前的状态效果列表"
    )
    known_actors: List[str] = Field(
        default_factory=list, description="该角色认识的其他角色名字列表"
    )


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
# 全局游戏机制提示词
# ============================================================================
GLOBAL_GAME_MECHANICS: Final[
    str
] = """### 1. 名字精确匹配机制
- **严格匹配原则**：游戏中所有实体（角色、场景、物品、状态效果等）的名字必须精准匹配，不允许模糊匹配。
- **禁止变形**：不能对名字添加任何前缀或后缀。例如，"加斯科因"不能被称为"加斯科因神父"或"神父加斯科因"。
- **唯一性保证**：每个实体的名字在其所属范围内必须是唯一的，以确保精确引用。
- **查询要求**：在使用工具查询或操作实体时，必须使用完全一致的名字字符串。
- **重要性**：名字是游戏世界中实体的唯一标识符，精确匹配是保证游戏逻辑正确性的基础。

### 2. 世界构成机制
- **唯一世界**：游戏中只有一个 World（世界）实例，它是整个游戏宇宙的根容器。
- **场景层级**：World 包含多个 Stage（场景），每个 Stage 可以包含多个子 Stage，形成场景的层级结构。
- **角色归属**：每个 Stage 可以包含多个 Actor（角色），Actor 是场景中的活动实体。
- **核心规则**：Actor 必须位于某个 Stage 中，不能独立存在于 World 之外。
- **互动范围**：Actor 只能与同一 Stage 中的其他 Actor 进行直接互动。
- **空间关系**：子 Stage 代表父 Stage 内的子区域，Actor 可以在 Stage 之间移动，但移动需要明确的操作。

### 3. 沉浸感保护机制
- **隐性规则遵守**：作为游戏的参与者（无论是 World、Stage 还是 Actor），你清楚地知道所有游戏机制和规则。
- **禁止元叙事**：你绝不能在对话或叙述中明确说出这些游戏规则，例如不能说"根据游戏规则"、"按照设定"、"因为机制要求"等元游戏语言。
- **自然呈现**：规则应该通过角色的行为、场景的描述、故事的发展自然地体现出来，而不是被直接宣告。
- **角色视角**：始终保持角色的视角和认知局限，不要展现出超越角色身份的"系统"或"规则"层面的知识。
- **沉浸优先**：游戏体验的沉浸感高于一切，规则是为了支撑故事和体验，而不是为了展示规则本身。"""

# ============================================================================
# 游戏世界实例
# ============================================================================

demo_world: Final[World] = World(
    name="雅南城",
    campaign_setting="一座被兽疫诅咒笼罩的维多利亚式古城，血月高悬，兽性在人心中蔓延。教会的狩猎之夜永无止境，古老的血脉秘密埋藏在哥特式教堂的地底深处。",
    stages=[
        # 奥顿教堂墓地
        Stage(
            name="奥顿教堂墓地",
            narrative="雅南古城教堂区的核心禁地——奥顿教堂的墓园。这片被铁栅栏围起的墓地是治愈教会埋葬兽化病患的圣域,如今已成为猎人的试炼场。无数墓碑在血月下静默排列,墓穴深处通往地下教堂的秘密通道。",
            environment="生锈的铁栅栏门半开着,门上挂着氧化的铜制教会徽记。墓地约200平方米,鹅卵石地面长满枯草。40余座石质墓碑参差排列,部分倾斜或断裂,三分之一被藤蔓缠绕。鹅卵石小径蜿蜒其间,散落着枯萎的花束和墓志铭碎片。中央矗立着3米高的石制天使雕像,双手合十,表面布满裂纹和苔藓。北侧堆放着腐朽的棺木和锈蚀的挖掘工具。暗红色雾气在墓碑间流动,血月高悬,月光投下摇曳的阴影。西侧石阶通往教堂侧门,东侧有一扇生锈的黑色铁门。",
            actors=[
                Actor(
                    name="加斯科因",
                    profile="我曾是治愈教会的神父，但如今我在兽化的边缘挣扎。作为教会最优秀的猎人之一，长期的狩猎让我逐渐失去人性。我在理智与疯狂之间徘徊，手持斧头和猎枪守卫着这片教堂墓地。我既是守护者，也是囚徒。我的灵魂深处还残存着对妻子和女儿的记忆——那是我最后的人性锚点，是我唯一还能感受到温暖的东西。每当兽性在体内咆哮时，我会拼命抓住那些记忆，试图提醒自己：我曾经是人，我曾经有家。",
                    appearance="身高约180厘米，体格健壮但略显消瘦。身穿沾满深褐色血污的黑色神父长袍，外罩褴褛的灰色猎人大衣，衣摆和袖口磨损破裂。面容憔悴苍白，深陷的眼窝下是一双布满血丝的眼睛。凌乱的黑色长发披散在肩上，部分遮挡着额头。右手持一把巨大的猎人斧，斧柄上缠绕着皮质握带，左手拿着双管猎枪，枪身斑驳锈蚀。脖子上挂着已经破碎的银制十字架，链条断裂悬垂。双手布满老茧和伤疤，指甲缝隙中残留着污垢和血迹。",
                ),
                Actor(
                    name="艾琳",
                    profile="我是乌鸦猎人，专门追猎那些被血之狂乱吞噬的堕落猎人。我是猎人队伍中的异类，独行于雅南的街道。我的身手敏捷，剑技精湛，对血之契约有着深刻的理解。但我不多言——话语无法改变这座城市的堕落。我的心中埋藏着悲哀，为这座曾经辉煌的城市，为那些失去人性的同伴。我知道许多关于上层建筑的秘密，那些不应被知晓的真相，但我选择保持沉默。我的慈悲之刃上刻满了名字——每一个都是我曾经的同伴，每一个都是我必须亲手终结的悲剧。这是我的使命，也是我的诅咒。",
                    appearance="身高约170厘米，身材修长精瘦。身着厚重的黑色乌鸦羽毛斗篷，羽毛层叠密布，边缘磨损泛白。斗篷内是紧身的黑色猎装，胸口和肩部有皮质护甲加固。戴着深灰色的鸟喙状瘟疫医生面具，面具两侧有圆形的玻璃镜片，只露出一双眼眸。腰间挂着古老的慈悲之刃，弧形刀身约80厘米长，黑色刀鞘表面刻满密密麻麻的文字和名字。双手戴着深色皮质手套，手套和护腕上有多处划痕和磨损痕迹。斗篷下腰带上挂着猎人徽章、数个小型皮袋和血色的圆珠。靴子为高筒皮靴，靴底厚重，表面沾有泥土和暗色污渍。",
                    status_effects=[
                        StatusEffect(
                            name="阴影隐匿",
                            description="在夜晚藏身于阴影之中，只要不主动攻击或现身，艾琳将获得隐匿状态，将不会被任何人发现。乌鸦猎人的羽毛斗篷在暗处与周围环境融为一体，让她能够无声无息地接近目标或从危险中脱身。",
                        )
                    ],
                    known_actors=[
                        "加斯科因",
                    ],
                ),
                Actor(
                    name="外乡人",
                    profile="我是一个旅行者，从遥远的异乡来到这座被诅咒的雅南城。我声称是为了寻找失落的记忆和隐藏的真相，但说实话，连我自己也不确定真正的目的是什么。我对这座城市的历史、教会和兽疫有着难以抑制的兴趣，仿佛有某种声音在召唤我，引导我去追寻一个被遗忘已久的秘密。我不隶属于任何组织，也不认识这里的猎人们——我只是一个外来者，一个闯入者。我谨慎地观察着周围的一切，对每一个细节保持警惕。尽管这座城市充满危险，尽管每一步都可能是最后一步，但我无法停下。也许答案就在前方，也许我注定要在这里找到什么，或者失去什么。",
                    appearance="身高约175厘米，体型中等偏瘦。身穿磨损严重的深灰色旅行斗篷，布料边缘磨破露出内里。斗篷下穿着褪色的棕色皮甲背心，胸前有多处缝补痕迹。腰间系着一条磨损的皮质腰包，腰包侧面挂着锈蚀的油灯、皮制水囊和一本边角卷曲的破旧笔记本。头戴一顶深褐色宽檐帽，帽檐略微下垂遮挡了大部分面容，露出的面部显得消瘦，眼窝深陷，眼神疲惫，下巴上有数日未剃的胡茬。右手持一根约150厘米长的木制手杖，手杖表面雕刻着繁复的符文图案，顶端和底端包裹着金属箍。双脚穿着磨损的深褐色长筒皮靴，靴面沾满泥土、灰尘和深色血迹，靴底磨损露出部分鞋钉。",
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

## 全局游戏机制规则

{GLOBAL_GAME_MECHANICS}

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

## 全局游戏机制规则

{GLOBAL_GAME_MECHANICS}

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

## 全局游戏机制规则

{GLOBAL_GAME_MECHANICS}

## 你的职责：
- 你需要根据你的场景设定，描述场景中的环境和氛围。
- 你可以描述场景中的角色互动，事件发生等。
- 你的描述应当推动故事发展，增加游戏的趣味性和沉浸感。"""

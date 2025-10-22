from typing import List, final
from ..entitas.components import Component, MutableComponent
from .dungeon import Skill, StatusEffect
from .objects import RPGCharacterProfile, Item
from .registry import register_component_class


############################################################################################################
# 全局唯一标识符 RunTimeIndexComponent
@final
@register_component_class
class RuntimeComponent(Component):
    name: str
    runtime_index: int
    uuid: str


############################################################################################################
# 记录kick off原始信息
@final
@register_component_class
class KickOffMessageComponent(Component):
    name: str
    content: str


############################################################################################################
# 标记kick off已经完成
@final
@register_component_class
class KickOffDoneComponent(Component):
    name: str
    response: str


############################################################################################################
# 例如，世界级的entity就标记这个组件
@final
@register_component_class
class WorldComponent(Component):
    name: str


############################################################################################################
# 场景标记
@final
@register_component_class
class StageComponent(Component):
    name: str


############################################################################################################
# 记录场景的描述 #Environment
@final
@register_component_class
class EnvironmentComponent(Component):
    name: str
    description: str


############################################################################################################
# 角色标记
@final
@register_component_class
class ActorComponent(Component):
    name: str
    current_stage: str


############################################################################################################
# 玩家标记
@final
@register_component_class
class PlayerComponent(Component):
    player_name: str


############################################################################################################
# 摧毁Entity标记
@final
@register_component_class
class DestroyComponent(Component):
    name: str


############################################################################################################
# 角色外观信息
@final
@register_component_class
class AppearanceComponent(Component):
    name: str
    appearance: str


############################################################################################################
# Stage专用，标记该Stage是Home
@final
@register_component_class
class HomeComponent(Component):
    name: str


############################################################################################################
# Stage专用，标记该Stage是Dungeon
@final
@register_component_class
class DungeonComponent(Component):
    name: str


############################################################################################################
# Actor专用，标记该Actor是Hero
@final
@register_component_class
class AllyComponent(Component):
    name: str


############################################################################################################
# Actor专用，标记该Actor是Monster
@final
@register_component_class
class EnemyComponent(Component):
    name: str


############################################################################################################


# 手牌组件。
@final
@register_component_class
class HandComponent(Component):
    """
    以下是针对卡牌游戏中 牌组、弃牌堆、抽牌堆、手牌 的类名设计建议，结合常见游戏术语和编程习惯：
    方案 4：极简统一型
    组件	类名	说明
    牌组	Deck	直接命名为 Deck，表示通用牌组。
    抽牌堆	DrawDeck	与 Deck 统一，通过前缀区分功能。
    弃牌堆	DiscardDeck	同上，保持命名一致性。
    手牌	Hand	简洁无冗余。
    play_card
    draw_card
    """

    name: str
    skills: List[Skill]


############################################################################################################
# 死亡标记
@final
@register_component_class
class DeathComponent(Component):
    name: str


############################################################################################################
# 新版本的重构！
@final
@register_component_class
class RPGCharacterProfileComponent(MutableComponent):
    name: str
    rpg_character_profile: RPGCharacterProfile
    status_effects: List[StatusEffect]

    @property
    def attrs_prompt(self) -> str:
        return f"""- 生命:{self.rpg_character_profile.hp}/{self.rpg_character_profile.max_hp}
- 物理攻击:{self.rpg_character_profile.physical_attack}
- 物理防御:{self.rpg_character_profile.physical_defense}
- 魔法攻击:{self.rpg_character_profile.magic_attack}
- 魔法防御:{self.rpg_character_profile.magic_defense}"""

    @property
    def status_effects_prompt(self) -> str:
        ret = "- 无"
        if len(self.status_effects) > 0:
            ret = "\n".join(
                [
                    f"- {effect.name}: {effect.description} (剩余{effect.duration}回合)"
                    for effect in self.status_effects
                ]
            )
        return ret


############################################################################################################


# 问号牌
@final
@register_component_class
class XCardPlayerComponent(Component):
    name: str
    skill: Skill


############################################################################################################


@final
@register_component_class
class InventoryComponent(MutableComponent):
    name: str
    items: List[Item]  # 物品列表，存储物品名称

    # 获取物品
    def find_item(self, item_name: str) -> Item | None:
        list_items = self.get_items([item_name])
        if len(list_items) > 0:
            return list_items[0]
        return None

    # 获取多个物品
    def get_items(self, item_names: List[str]) -> List[Item]:
        found_items = []
        for item in self.items:
            if item.name in item_names:
                found_items.append(item)
        return found_items

    # 打包成提示词型的字符串
    @property
    def list_items_prompt(self) -> str:
        if len(self.items) == 0:
            return "- 无"
        return "\n".join(
            [
                f"- {item.name}: {item.description}, 数量: {item.count}"
                for item in self.items
            ]
        )


############################################################################################################
############################################################################################################
############################################################################################################
############################################################################################################
############################################################################################################
# 以下是狼人杀的用的组件。


@final
@register_component_class
class ModeratorComponent(Component):
    name: str


@final
@register_component_class
class WerewolfComponent(Component):
    name: str


@final
@register_component_class
class SeerComponent(Component):
    name: str


@final
@register_component_class
class WitchComponent(Component):
    name: str


@final
@register_component_class
class VillagerComponent(Component):
    name: str


@final
@register_component_class
class NightActionReadyComponent(Component):
    name: str


@final
@register_component_class
class NightActionCompletedComponent(Component):
    name: str


@final
@register_component_class
class NightKillTargetComponent(Component):
    name: str
    turn: int


@final
@register_component_class
class DayDiscussedComponent(Component):
    name: str
    message: str


@final
@register_component_class
class DayVotedComponent(Component):
    name: str

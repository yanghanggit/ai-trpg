from typing import final, override
from ..entitas import Entity, GroupEvent, Matcher, ReactiveProcessor
from ..models import (
    WitchPoisonAction,
    WitchItemName,
    InventoryComponent,
    AgentEvent,
    NightKillTargetComponent,
)
from loguru import logger
from ..game.sdg_game import SDGGame


####################################################################################################################################
@final
class WitchPoisonActionSystem(ReactiveProcessor):

    def __init__(self, game_context: SDGGame) -> None:
        super().__init__(game_context)
        self._game: SDGGame = game_context

    ####################################################################################################################################
    @override
    def get_trigger(self) -> dict[Matcher, GroupEvent]:
        return {Matcher(WitchPoisonAction): GroupEvent.ADDED}

    ####################################################################################################################################
    @override
    def filter(self, entity: Entity) -> bool:
        return entity.has(WitchPoisonAction)

    ####################################################################################################################################
    @override
    async def react(self, entities: list[Entity]) -> None:
        for entity in entities:
            self._process_action(entity)

    ####################################################################################################################################
    def _process_action(self, entity: Entity) -> None:
        logger.debug(f"🧪 处理女巫毒杀行动 = {entity.name}")

        witch_poison_action = entity.get(WitchPoisonAction)
        assert entity.name == witch_poison_action.name, "实体名称和目标名称不匹配"

        witch_entity = self._game.get_entity_by_name(witch_poison_action.witch_name)
        assert witch_entity is not None, "找不到女巫实体"
        if witch_entity is None:
            logger.error(f"找不到女巫实体 = {witch_poison_action.witch_name}")
            return

        inventory_component = witch_entity.get(InventoryComponent)
        assert inventory_component is not None, "女巫实体没有道具组件"

        poison_item = inventory_component.find_item(WitchItemName.POISON)
        # assert poison_item is not None, "女巫没有毒药，无法使用毒药"
        if poison_item is None:
            logger.error(f"女巫 {witch_entity.name} 没有毒药，无法使用毒药")
            self._game.notify_entities(
                set({witch_entity}),
                AgentEvent(
                    message=f"# 提示！你没有毒药，无法对 {entity.name} 使用毒药。",
                ),
            )
            return

        logger.debug(f"女巫 {witch_entity.name} 对 {entity.name} 使用了毒药")

        # 移除毒药道具
        inventory_component.items.remove(poison_item)

        # 通知女巫使用毒药成功
        self._game.notify_entities(
            set({witch_entity}),
            AgentEvent(
                message=f"# 女巫 {witch_entity.name} 使用了毒药，成功毒杀了玩家 {entity.name}, 并且毒药已被使用。",
            ),
        )

        entity.replace(
            NightKillTargetComponent,
            entity.name,
            self._game._turn_counter,
        )

    ####################################################################################################################################

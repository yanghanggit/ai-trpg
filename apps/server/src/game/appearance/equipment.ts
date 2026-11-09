import type { Database } from "../../db/pool";
import { findActorByName } from "../actors";
import { bumpGameVersion } from "../apply/messages";
import { GameError } from "../errors";
import { equipSlot, unequipSlot } from "../items";
import { setActorEquipment } from "../persistence/actors";
import { lockGameRow } from "../persistence/games";
import { getGameStateSlice } from "../read/game-state";
import type { EquipmentSlot } from "../types";
import { type AppearanceTurnOptions, type EquipmentResult, runAppearanceTurn } from "./turn";

/**
 * 换装后立刻重算外观；LLM 调用在事务外，槽位与外观各自短事务。
 */
export async function setEquipmentSlot(
  db: Database,
  gameRef: string,
  actorRef: string,
  slot: EquipmentSlot,
  itemName: string | null,
  options: AppearanceTurnOptions,
): Promise<EquipmentResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActorByName(state, actorRef).actor;

  let equipment = actor.equipment;
  if (itemName !== null) {
    const item = actor.items.find((candidate) => candidate.name === itemName);
    if (!item) {
      throw new GameError("not_found", `actor 没有物品: ${itemName}`);
    }
    equipment = equipSlot(equipment, slot, item);
  } else {
    equipment = unequipSlot(equipment, slot);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能换装: ${game.status}`);
    }
    await setActorEquipment(tx, actor.id, equipment, now);
    await bumpGameVersion(tx, state.game.id, now);
  });

  const appearance = await runAppearanceTurn(db, gameRef, actor.name, options);
  return { ...appearance, slot, itemName };
}

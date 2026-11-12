import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import { participatesInAppearance, unequipSlot } from "../item-state";
import {
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type UnequipAction,
} from "../kernel/types";
import { setActorEquipment } from "../persistence/actors";
import { loadActorItemByName } from "../persistence/items";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedUnequip } from "../settle/types";
import { parseSlot } from "./equip";
import type { ActionResult } from "./registry";

const SLOT_LABELS = EQUIPMENT_SLOTS.map((slot) => `${slot}（${EQUIPMENT_SLOT_LABELS[slot]}）`).join(
  " / ",
);

export function buildUnequipTool(occupiedSlots: readonly EquipmentSlot[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "unequip",
      description: `卸下某个槽位的装备：${SLOT_LABELS}。卸下的道具仍留在背包里。`,
      parameters: {
        type: "object",
        properties: {
          slot: {
            type: "string",
            ...(occupiedSlots.length > 0 ? { enum: [...occupiedSlots] } : {}),
            description: "要卸下的槽位",
          },
        },
        required: ["slot"],
      },
    },
  };
}

export function parseUnequip(args: Record<string, unknown>): UnequipAction {
  return { kind: "unequip", slot: parseSlot(args.slot) };
}

export function resolveUnequip(
  actorRow: ActorWithStageRow,
  action: UnequipAction,
): ResolvedUnequip {
  const itemName = actorRow.actor.equipment[action.slot];
  if (itemName === undefined) {
    throw new GameError(
      "invalid_action",
      `${EQUIPMENT_SLOT_LABELS[action.slot]}槽没有装备: ${actorRow.actor.name}`,
    );
  }
  return { kind: "unequip", action, stage: actorRow.stage, itemName };
}

export async function applyUnequip(
  executor: Executor,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUnequip,
  now: Date,
): Promise<ActionResult> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  // 卸下的道具仍留在背包里，读到的就是刚离开槽位的那件：用它判定外观要不要重算。
  const item = await loadActorItemByName(executor, actor.id, resolved.itemName);
  const equipment = unequipSlot(actorRow.actor.equipment, resolved.action.slot);
  await setActorEquipment(executor, actor.id, equipment, now);

  const label = EQUIPMENT_SLOT_LABELS[resolved.action.slot];
  // 与穿戴同一口径：动作只回给发起人，旁人看外观结果。
  return {
    feedback: `你卸下了${resolved.itemName}（${label}）。`,
    // 读不到道具时按“可能影响外观”处理：宁可多算一次，也不留下旧外观。
    affectsAppearance: item === undefined || participatesInAppearance(item),
  };
}

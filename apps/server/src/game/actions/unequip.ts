import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf, plainEntityName } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import type { ActorWithStageRow, Executor, ResolvedUnequip } from "../apply/types";
import { GameError } from "../errors";
import { unequipSlot } from "../items";
import { renderAction, withAppearances } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import {
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type UnequipAction,
} from "../types";
import { parseSlot } from "./equip";

const SLOT_LABELS = EQUIPMENT_SLOTS.map((slot) => `${slot}（${EQUIPMENT_SLOT_LABELS[slot]}）`).join(
  " / ",
);

export function buildUnequipTool(occupiedSlots: readonly EquipmentSlot[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "unequip",
      description: `卸下某个槽位的装备：${SLOT_LABELS}。卸下的物品仍留在背包里。换装只改变穿戴关系，不会立刻重写外观快照。`,
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
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUnequip,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const equipment = unequipSlot(actorRow.actor.equipment, resolved.action.slot);
  await setActorEquipment(executor, actor.id, equipment, now);
  await bumpGameVersion(executor, gameId, now);

  const label = EQUIPMENT_SLOT_LABELS[resolved.action.slot];
  const content = `${actor.name}卸下了${resolved.itemName}（${label}）。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "unequip",
    stageId: resolved.stage.id,
    visibility: "stage",
    content,
  });
  await appendCustomStageObservation(
    executor,
    gameId,
    resolved.stage.id,
    actor.id,
    (_observer, address) =>
      renderAction(
        withAppearances(
          `# 场景动态\n${mentionOf(address(actor.id))}卸下了${plainEntityName(resolved.itemName)}（${label}）。`,
          [address(actor.id)],
        ),
        resolved.stage.id,
      ),
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "unequip",
    },
    trace,
  );
  return `# 行动结果\n你卸下了${resolved.itemName}（${label}）。`;
}

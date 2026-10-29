import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { mentionOf } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedEquip } from "../apply/types";
import { GameError } from "../errors";
import { equipSlot } from "../items";
import { renderAction, withAppearances } from "../observation-text";
import { appendCustomStageObservation, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import {
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  type EquipAction,
  type EquipmentSlot,
} from "../types";

const SLOT_LABELS = EQUIPMENT_SLOTS.map((slot) => `${slot}（${EQUIPMENT_SLOT_LABELS[slot]}）`).join(
  " / ",
);

export function buildEquipTool(wearableItemNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "equip",
      description: `把背包里的一件物品穿到槽位：${SLOT_LABELS}。槽位必须接受该物品的大类；同槽原有物品会被替换，被替换的物品仍留在背包。换装只改变穿戴关系，不会立刻重写外观快照。`,
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            ...(wearableItemNames.length > 0 ? { enum: [...wearableItemNames] } : {}),
            description: "背包里要穿戴的物品名",
          },
          slot: {
            type: "string",
            enum: [...EQUIPMENT_SLOTS],
            description: "目标槽位",
          },
        },
        required: ["itemName", "slot"],
      },
    },
  };
}

export function parseSlot(value: unknown): EquipmentSlot {
  const slot = typeof value === "string" ? value.trim() : "";
  if (!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) {
    throw new GameError("invalid_action", `未知的装备槽位: ${slot}`);
  }
  return slot as EquipmentSlot;
}

export function parseEquip(args: Record<string, unknown>): EquipAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "equip 需要非空 itemName");
  }
  return { kind: "equip", itemName, slot: parseSlot(args.slot) };
}

export async function resolveEquip(
  executor: Executor,
  actorRow: ActorWithStageRow,
  action: EquipAction,
): Promise<ResolvedEquip> {
  const item = await resolveActorItem(executor, actorRow.actor.id, action.itemName);
  // 提前校验，避免把非法槽位写进索引；真正写入由 equipSlot 再校验一次。
  equipSlot(actorRow.actor.equipment, action.slot, item);
  return { kind: "equip", action, stage: actorRow.stage, item };
}

export async function applyEquip(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedEquip,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const item = resolved.item;
  const equipment = equipSlot(actorRow.actor.equipment, resolved.action.slot, item);
  await setActorEquipment(executor, actor.id, equipment, now);
  await bumpGameVersion(executor, gameId, now);

  const label = EQUIPMENT_SLOT_LABELS[resolved.action.slot];
  const content = `${actor.name}穿上了${item.name}（${label}）。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "equip",
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
          `# 场景动态\n${mentionOf(address(actor.id))}穿上了${item.name}（${label}）。`,
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
      eventKind: "equip",
    },
    trace,
  );
  return `# 行动结果\n你穿上了${item.name}（${label}）。`;
}

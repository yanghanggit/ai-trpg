import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { type AddressLookup, actionRef } from "../addressing";
import { GameError } from "../errors";
import { withoutEquippedItem } from "../item-state";
import { assertNotSelf, isAlive, listActorItems } from "../lookup";
import { appendItemObservations, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import { transferItemToActor } from "../persistence/items";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedLoot } from "../settle/types";
import type { LootAction } from "../types";

/**
 * 搜刮尸体：与 `pickup` 平行的取物入口，对象只能是同场景的尸体。
 *
 * 与 `steal` 的分工由对象决定：活人走 `steal`（私密、拿不走穿戴中的物品），
 * 尸体走 `loot`（公开、什么都能拿）。不传物品名即搜刮全部：背包没有上限，
 * 逐件取走只是噪声，所以一次动作会把尸体搬空。
 */
export function buildLootTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "loot",
      description:
        "把一次搜刮加入计划：从同场景的尸体上取走物品（道具、材料、甚至它穿戴的东西），在场的人都看得见。省略 itemNames 就是搜刮全部；只能对尸体。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "被搜刮的同场景尸体的引用（名字 或 #编号）",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
          itemNames: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "要取走的物品名列表；省略或留空表示把尸体身上的东西全搜走，按列表顺序结算",
          },
        },
        required: ["targetActorHandle"],
      },
    },
  };
}

/** 省略与空列表等价：都表示搜刮全部；给了名字就必须非空且不重复。 */
export function parseLoot(args: Record<string, unknown>): LootAction {
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "loot 需要非空 targetActorHandle");
  }
  const raw = args.itemNames;
  if (raw === undefined) {
    return { kind: "loot", targetActorHandle };
  }
  if (!Array.isArray(raw)) {
    throw new GameError("invalid_action", "loot 的 itemNames 必须是物品名数组");
  }
  const itemNames = raw.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (itemNames.some((name) => name.length === 0)) {
    throw new GameError("invalid_action", "loot 的 itemNames 不能含空名字");
  }
  if (new Set(itemNames).size !== itemNames.length) {
    throw new GameError("invalid_action", "loot 的 itemNames 不能重复");
  }
  if (itemNames.length === 0) {
    return { kind: "loot", targetActorHandle };
  }
  return { kind: "loot", targetActorHandle, itemNames };
}

/**
 * 尸体没有「穿戴保护」：武器、护甲、材料一视同仁，取走时顺带清空它的穿戴槽。
 * 活人不是搜刮对象——那条路留给 steal，两边的拒绝文案互相指路。
 * 点名取物时整批先校验：只要有一件不在尸体上，整次搜刮都不成立。
 */
export async function resolveLoot(
  executor: Executor,
  stage: ResolvedLoot["stage"],
  actorId: string,
  action: LootAction,
  target: ResolvedLoot["target"],
): Promise<ResolvedLoot> {
  assertNotSelf(target, actorId);
  if (isAlive(target)) {
    throw new GameError("invalid_action", `${target.name}还活着，搜刮只对尸体；活人用 steal`);
  }
  const owned = await listActorItems(executor, target.id);
  const byName = new Map(owned.map((row) => [row.name, row] as const));
  if (action.itemNames === undefined) {
    if (owned.length === 0) {
      throw new GameError("invalid_action", `${target.name}身上没有可搜刮的物品`);
    }
    return { kind: "loot", action, stage, target, items: owned };
  }
  const missing = action.itemNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new GameError("invalid_action", `${target.name}身上没有这些物品: ${missing.join("、")}`);
  }
  const items = action.itemNames.map((name) => {
    const item = byName.get(name);
    if (!item) {
      // 上面已整批校验过，这里只防同一事务里被写走。
      throw new GameError("invalid_action", `${target.name}身上没有这件物品: ${name}`);
    }
    return item;
  });
  return { kind: "loot", action, stage, target, items };
}

export async function applyLoot(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedLoot,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const looter = { id: actorRow.actor.id, name: actorRow.actor.name };
  const corpse = { id: resolved.target.id, name: resolved.target.name };
  const itemNames = resolved.items.map((item) => item.name);

  let corpseEquipment = resolved.target.equipment;
  for (const item of resolved.items) {
    await transferItemToActor(executor, item, looter.id);
    corpseEquipment = withoutEquippedItem(corpseEquipment, item.name);
  }
  await setActorEquipment(executor, corpse.id, corpseEquipment, now);
  await bumpGameVersion(executor, gameId, now);

  // 搜刮是公开行为：与 pickup 同级，不沿用 steal 的私密可见性。
  const content = `${looter.name}从${corpse.name}的尸体上搜走了${itemNames.join("、")}。`;
  await appendPublicMessage(executor, gameId, looter.id, {
    kind: "loot",
    stageId: resolved.stage.id,
    targetActorId: corpse.id,
    visibility: "stage",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    {
      actor: looter,
      event: "loot",
      target: corpse,
      itemNames,
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "loot",
      targetActorId: corpse.id,
    },
    trace,
  );
  return `# 行动结果\n你从${actionRef(address(corpse.id))}的尸体上搜走了${itemNames.join("、")}。`;
}

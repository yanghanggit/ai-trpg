/**
 * 物品与穿戴的文本投影：同一份状态，给模型看的样子。
 *
 * 只做投影：不查库、不裁决。同一件东西会在三处被读（自己的 get_self、别人的 inspect、
 * 场景锚点上），所以只留这一份渲染，免得三处对同一件物品说法不一致。
 */

import { STAT_LABELS } from "../attributes";
import { type ActorState, EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS, type ItemState } from "../types";

/** 材料的来源只对 material 有意义；其它大类不展示多余的字段。 */
export function itemSourceNote(item: ItemState): string {
  return item.kind === "material" && item.source ? `，源自 ${item.source}` : "";
}

export function describeItems(actor: Pick<ActorState, "items" | "equipment">): string {
  if (actor.items.length === 0) {
    return "物品：无";
  }
  const lines = actor.items.map((item) => {
    const { damage, block } = item.stats;
    const notes: string[] = [];
    if (damage > 0 || block > 0) {
      notes.push(`${STAT_LABELS.damage} ${damage}`, `${STAT_LABELS.block} ${block}`);
    }
    // 物品提供的动作只在穿戴时生效；写出来，模型才知道能否挥击、卸下会失去什么。
    if (item.actions.length > 0) {
      notes.push(`提供 ${item.actions.join("、")}`);
    }
    const stats = notes.length > 0 ? `（${notes.join("，")}）` : "";
    const worn = Object.values(actor.equipment).includes(item.name) ? "，已穿戴" : "";
    return `- ${item.name}（${item.kind}，count ${item.count}${itemSourceNote(item)}${worn}）：${item.description}${stats}`;
  });
  return `物品：
${lines.join("\n")}`;
}

export function describeEquipment(actor: Pick<ActorState, "equipment">): string {
  const lines = EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`- ${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  });
  return lines.length === 0 ? "穿戴：无" : `穿戴：\n${lines.join("\n")}`;
}

/**
 * 同场景角色名单里的穿戴摘要：一行只列已穿戴的槽位。
 *
 * 与 `describeEquipment` 的区别是给名单内联用；没穿东西时返回空串。
 * 完整背包（含未穿戴物品与数值）走 `inspect` 动作。
 */
export function describeEquipmentBrief(actor: Pick<ActorState, "equipment">): string {
  return EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  }).join("；");
}

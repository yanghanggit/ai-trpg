import { GameError } from "../errors";
import type { ActionKind } from "../types";

/** 全部动作 kind；顺序与提示词里的列举保持一致，供测试与文档引用。 */
export const ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "move",
  "wait",
  "attack",
  "steal",
  "give",
  "pickup",
  "use",
  "equip",
  "unequip",
] as const satisfies readonly ActionKind[];

export const ACTION_SUMMARIES: Record<ActionKind, string> = {
  say: "对目标公开说话",
  whisper: "对目标耳语，只有对方听见",
  announce: "向当前场景公开说话",
  move: "移动到相邻场景",
  wait: "留在原地",
  attack: "攻击同场景目标",
  steal: "从目标身上取物",
  give: "把自己的物品交给目标",
  pickup: "拾起场景物品",
  use: "用自己的物品作用于角色或场景",
  equip: "把背包里的物品穿到槽位",
  unequip: "卸下某个槽位的装备",
};

/** 角色可用的行动：按固定顺序排列，供提示词与工具挂载使用。 */
export function allowedActionKinds(actorActions: readonly ActionKind[]): ActionKind[] {
  return ACTION_KINDS.filter((kind) => actorActions.includes(kind));
}

/** 结算前的权威校验：actor 必须拥有该动作。 */
export function assertActionAllowed(
  actorActions: readonly ActionKind[],
  kind: ActionKind,
  actorName: string,
): void {
  if (!actorActions.includes(kind)) {
    throw new GameError("invalid_action", `角色 ${actorName} 不能使用动作: ${kind}`);
  }
}

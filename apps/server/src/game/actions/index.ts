import { GameError } from "../errors";
import type { ActionKind } from "../types";

/** 全部动作 kind；顺序与提示词里的列举保持一致，供测试与文档引用。 */
export const ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "move",
  "teleport",
  "wait",
  "strike",
  "brawl",
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
  teleport: "传送到去过的场景",
  wait: "留在原地",
  strike: "用装备的武器攻击同场景目标",
  brawl: "用身体与同场景目标肉搏",
  steal: "从目标身上取物",
  give: "把自己的物品交给目标",
  pickup: "拾起场景物品",
  use: "用自己的物品作用于角色或场景",
  equip: "把背包里的物品穿到槽位",
  unequip: "卸下某个槽位的装备",
};

/**
 * 角色可用的行动：固有 actions ∪ 穿戴中物品提供的 actions；顺序固定，不随合并顺序变化。
 *
 * 工具列表、提示词里的动作列举、结算前的授权都用这一份结果，避免三处各自算。
 */
export function allowedActionKinds(
  actorActions: readonly ActionKind[],
  grantedActions: readonly ActionKind[] = [],
): ActionKind[] {
  const available: readonly ActionKind[] = [...actorActions, ...grantedActions];
  return ACTION_KINDS.filter((kind) => available.includes(kind));
}

/** 结算前的权威校验：`allowedActions` 是已经合并过物品动作的可用清单。 */
export function assertActionAllowed(
  allowedActions: readonly ActionKind[],
  kind: ActionKind,
  actorName: string,
): void {
  if (allowedActions.includes(kind)) {
    return;
  }
  // actorName 就是实体的名字，CLI 与日志直接用它定位。
  throw new GameError("invalid_action", `${actorName} 不能使用动作: ${kind}`);
}

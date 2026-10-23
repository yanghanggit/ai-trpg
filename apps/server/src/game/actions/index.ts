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
] as const satisfies readonly ActionKind[];

/** 每个动作给提示词用的一句话说明。 */
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
};

/** 角色与场景共同允许的动作：actor 必须列出，场景非空时进一步收窄。 */
export function allowedActionKinds(
  actorActions: readonly ActionKind[],
  stageActions: readonly ActionKind[],
): ActionKind[] {
  if (stageActions.length === 0) {
    return [...actorActions];
  }
  return actorActions.filter((kind) => stageActions.includes(kind));
}

/** 结算前的权威校验：actor 必须拥有该动作，场景非空时还必须允许。 */
export function assertActionAllowed(
  actorActions: readonly ActionKind[],
  stageActions: readonly ActionKind[],
  kind: ActionKind,
  actorName: string,
): void {
  if (!actorActions.includes(kind)) {
    throw new GameError("invalid_action", `角色 ${actorName} 不能使用动作: ${kind}`);
  }
  if (stageActions.length > 0 && !stageActions.includes(kind)) {
    throw new GameError("invalid_action", `当前场景不允许动作: ${kind}`);
  }
}

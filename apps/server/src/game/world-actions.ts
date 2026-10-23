import type { WorldActionKind } from "./types";

/** world 是否能向 stage 下发裁决。 */
export function canNotifyStage(actions: readonly WorldActionKind[]): boolean {
  return actions.includes("notify_stage");
}

/** world 是否能结束游戏。 */
export function canEndGame(actions: readonly WorldActionKind[]): boolean {
  return actions.includes("end_game");
}

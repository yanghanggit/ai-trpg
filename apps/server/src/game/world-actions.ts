import type { WorldActionKind } from "./types";

/** world 可执行的全部动作；名称与工具名一致。 */
export const WORLD_ACTION_KINDS = [
  "notify_stage",
  "end_game",
] as const satisfies readonly WorldActionKind[];

/** world 是否能向 stage 下发裁决。 */
export function canNotifyStage(actions: readonly WorldActionKind[]): boolean {
  return actions.includes("notify_stage");
}

/** world 是否能结束游戏。 */
export function canEndGame(actions: readonly WorldActionKind[]): boolean {
  return actions.includes("end_game");
}

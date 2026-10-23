import type { StageActionKind } from "./types";

/** 场景可执行的全部动作；名称与工具名一致。 */
export const STAGE_ACTION_KINDS = [
  "submit_environment",
] as const satisfies readonly StageActionKind[];

/** 该场景是否具备更新 environment 的能力。 */
export function canSubmitEnvironment(actions: readonly StageActionKind[]): boolean {
  return actions.includes("submit_environment");
}

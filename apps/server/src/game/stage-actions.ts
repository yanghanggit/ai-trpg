import type { StageActionKind } from "./types";

/** 场景可执行的全部动作；名称与工具名一致。 */
export const STAGE_ACTION_KINDS = [
  "submit_environment",
  "notify_world",
] as const satisfies readonly StageActionKind[];

/** 该场景是否具备更新 environment 的能力。 */
export function canSubmitEnvironment(actions: readonly StageActionKind[]): boolean {
  return actions.includes("submit_environment");
}

/** 该场景是否具备向 world 发通知的能力。 */
export function canNotifyWorld(actions: readonly StageActionKind[]): boolean {
  return actions.includes("notify_world");
}

import type { StageActionKind } from "./types";

/** 该场景是否具备更新 environment 的能力。 */
export function canSubmitEnvironment(actions: readonly StageActionKind[]): boolean {
  return actions.includes("submit_environment");
}

/** 该场景是否具备向 world 发通知的能力。 */
export function canNotifyWorld(actions: readonly StageActionKind[]): boolean {
  return actions.includes("notify_world");
}

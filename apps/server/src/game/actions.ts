/** 沟通类动作；它们需要目标或消息，并产生听觉观察。 */
export const COMMUNICATION_ACTION_TYPES = ["say", "whisper", "announce"] as const;
export type CommunicationActionType = (typeof COMMUNICATION_ACTION_TYPES)[number];

/** 移动类动作；它们占用同一个行动槽。 */
export const MOVEMENT_ACTION_TYPES = ["move", "wait"] as const;
export type MovementActionType = (typeof MOVEMENT_ACTION_TYPES)[number];

export type MessageVisibility = "stage" | "private";

/** 判断未知值是否为合法沟通动作。 */
export function isCommunicationAction(value: unknown): value is CommunicationActionType {
  return (
    typeof value === "string" && (COMMUNICATION_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** 判断未知值是否为合法移动动作。 */
export function isMovementAction(value: unknown): value is MovementActionType {
  return typeof value === "string" && (MOVEMENT_ACTION_TYPES as readonly string[]).includes(value);
}

/** 沟通动作的公共可见性。 */
export function visibilityForCommunication(action: CommunicationActionType): MessageVisibility {
  return action === "whisper" ? "private" : "stage";
}

/** agent memory 中使用的稳定 kind 值。 */
export const MEMORY_KINDS = {
  actorSystemPrompt: "actor_system_prompt",
  actionFeedback: "action_feedback",
  actionRejected: "action_rejected",
  planFailed: "plan_failed",
  environmentObservation: "environment_observation",
  actionObservation: "action_observation",
  communicationObservation: "communication_observation",
} as const;

/** 未指定时的 NPC loop 最大轮数。 */
export const DEFAULT_NPC_MAX_ROUNDS = 4;

/** 沟通 intent 的 mind 建议长度上限。 */
export const MAX_MIND_LENGTH = 60;

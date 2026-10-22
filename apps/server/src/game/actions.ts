/** Actor 可执行的动作类型与共享元数据。 */
export const ACTOR_ACTION_TYPES = ["wait", "move", "say", "whisper", "announce"] as const;
export type ActorActionType = (typeof ACTOR_ACTION_TYPES)[number];

/** 说话类动作；它们需要目标或消息，并产生听觉观察。 */
export const SPEECH_ACTION_TYPES = ["say", "whisper", "announce"] as const;
export type SpeechActionType = (typeof SPEECH_ACTION_TYPES)[number];

export type MessageVisibility = "stage" | "private";

export type ActionDefinition = {
  description: string;
};

export const ACTION_DEFINITIONS: Record<ActorActionType, ActionDefinition> = {
  wait: { description: "留在原地" },
  move: { description: "移动到相邻场景" },
  say: { description: "对一名角色公开说话" },
  whisper: { description: "只对一名角色耳语" },
  announce: { description: "无目标向当前场景公开说话" },
};

/** 判断未知值是否为合法 actor 动作。 */
export function isActorActionType(value: unknown): value is ActorActionType {
  return typeof value === "string" && (ACTOR_ACTION_TYPES as readonly string[]).includes(value);
}

/** 判断未知值是否为合法说话动作。 */
export function isSpeechAction(value: unknown): value is SpeechActionType {
  return typeof value === "string" && (SPEECH_ACTION_TYPES as readonly string[]).includes(value);
}

/** 说话动作的公共可见性。 */
export function visibilityForSpeech(action: SpeechActionType): MessageVisibility {
  return action === "whisper" ? "private" : "stage";
}

/** agent memory 中使用的稳定 kind 值。 */
export const MEMORY_KINDS = {
  actorSystemPrompt: "actor_system_prompt",
  actionFeedback: "action_feedback",
  actionRejected: "action_rejected",
  planFailed: "plan_failed",
  environmentObservation: "environment_observation",
  speechObservation: "speech_observation",
} as const;

export type MemoryKind = (typeof MEMORY_KINDS)[keyof typeof MEMORY_KINDS];

export const DEFAULT_NPC_MAX_ROUNDS = 4;
export const MAX_MIND_LENGTH = 60;

/**
 * 记忆类别的稳定标记。
 *
 * 这些字符串会被写进 `agent_memory_messages.metadata.kind`，因此是持久化格式的一部分：
 * 改名等于改数据，已有记忆会读不回来。它们不表达任何玩法设定，也不该被配置覆盖。
 */

/** agent memory 中使用的稳定 kind 值。 */
export const MEMORY_KINDS = {
  actorSystemPrompt: "actor_system_prompt",
  actorOpeningBriefing: "actor_opening_briefing",
  compactedMemory: "compacted_memory",
  stageSystemPrompt: "stage_system_prompt",
  stageOpeningSnapshot: "stage_opening_snapshot",
  worldSystemPrompt: "world_system_prompt",
  stageObservation: "stage_observation",
  actionFeedback: "action_feedback",
  identityUpdate: "identity_update",
  routeRecall: "route_recall",
  routeFailed: "route_failed",
  actionRejected: "action_rejected",
  planFailed: "plan_failed",
  environmentObservation: "environment_observation",
  actionObservation: "action_observation",
  communicationObservation: "communication_observation",
  worldNotification: "world_notification",
  worldDirective: "world_directive",
  worldEvent: "world_event",
} as const;

/** 记忆类别；与 `MEMORY_KINDS` 同源，新增 kind 时自动扩展。 */
export type MemoryKind = (typeof MEMORY_KINDS)[keyof typeof MEMORY_KINDS];

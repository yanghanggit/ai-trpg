/** 一轮最多提交的动作条数；具体“做什么组合”交给提示词约定，不做分类校验。 */
export const MAX_ACTIONS_PER_TURN = 2;

/** 未指定时的 NPC loop 最大轮数。 */
export const DEFAULT_NPC_MAX_ROUNDS = 4;

/** 外观推理 loop 的最大轮数。 */
export const DEFAULT_APPEARANCE_MAX_ROUNDS = 3;

/** 一次外观快照的最大字符数。 */
export const MAX_APPEARANCE_LENGTH = 300;

/** 沟通类动作的 mind（第一人称内心独白）建议长度上限。 */
export const MAX_MIND_LENGTH = 60;

/** agent memory 中使用的稳定 kind 值。 */
export const MEMORY_KINDS = {
  actorSystemPrompt: "actor_system_prompt",
  stageSystemPrompt: "stage_system_prompt",
  stageObservation: "stage_observation",
  actionFeedback: "action_feedback",
  actionRejected: "action_rejected",
  planFailed: "plan_failed",
  environmentObservation: "environment_observation",
  actionObservation: "action_observation",
  communicationObservation: "communication_observation",
} as const;

/**
 * 一轮最多提交的动作条数。
 *
 * 当前收紧为 1：一个回合只结算一个动作，机制最简单也最难被绕过；
 * 「沟通 + 移动」这类组合改为连续多个回合完成。
 */
export const MAX_ACTIONS_PER_TURN = 1;

/** 一轮 stage 最多向 world 发出的通知条数。 */
export const MAX_STAGE_NOTIFICATIONS_PER_TURN = 2;

/** 一轮 world 最多执行的下行/结束动作条数；只读工具不计入。 */
export const MAX_WORLD_ACTIONS_PER_TURN = 3;

/** 词缀 agent 一次执行最多记录几条可见后果。 */
export const MAX_AFFIX_EFFECTS = 2;

/** 一个场景最多保留的可交互锚点数。 */
export const MAX_STAGE_ANCHORS = 8;

/** 未指定时的 NPC loop 最大轮数。 */
export const DEFAULT_NPC_MAX_ROUNDS = 4;

/**
 * 运行时 agent 的默认通讯重试次数：只作用于 `retryable` 的传输错误，
 * 就地重发同一请求、不占工具轮次。业务可以按回合强度在调用点覆盖。
 */
export const DEFAULT_LLM_ERROR_RETRIES = 2;

/**
 * stage 小 GM 的轮数上限：environment + open_passage + 两条通知，再加一次纠偏。
 * 与动作上限绑在一起，保证「按任务提示正常规划」在结构上能完成一轮。
 */
export const DEFAULT_STAGE_MAX_ROUNDS = MAX_STAGE_NOTIFICATIONS_PER_TURN + 3;

/** world 的轮数上限：一次定位 + 全部写动作 + 提交 + 一次纠偏余量。 */
export const DEFAULT_WORLD_MAX_ROUNDS = MAX_WORLD_ACTIONS_PER_TURN + 3;

/** 外观推理 loop 的最大轮数。 */
export const DEFAULT_APPEARANCE_MAX_ROUNDS = 3;

/** 掉落推理 loop 的最大轮数；只有一个终止工具，留一次纠偏。 */
export const DEFAULT_DROP_MAX_ROUNDS = 3;

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
  learnedStage: "learned_stage",
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

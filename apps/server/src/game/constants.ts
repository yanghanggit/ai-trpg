/** 一轮最多提交的动作条数；具体“做什么组合”交给提示词约定，不做分类校验。 */
export const MAX_ACTIONS_PER_TURN = 2;

/** 一轮 stage 最多向 world 发出的通知条数。 */
export const MAX_STAGE_NOTIFICATIONS_PER_TURN = 2;

/** 一轮 world 最多执行的下行/结束动作条数；只读工具不计入。 */
export const MAX_WORLD_ACTIONS_PER_TURN = 3;

/** 使用道具时，对场景具体部位描述的最大长度。 */
export const MAX_TARGET_DETAIL_LENGTH = 120;

/** stage 发给 world 的单条通知最大长度。 */
export const MAX_WORLD_NOTIFICATION_LENGTH = 500;

/** world 发给 stage 的单条指令最大长度。 */
export const MAX_WORLD_DIRECTIVE_LENGTH = 1000;

/** 未指定时的 NPC loop 最大轮数。 */
export const DEFAULT_NPC_MAX_ROUNDS = 4;

/**
 * stage 小 GM 的轮数上限：look_stage + environment + open_passage + 两条通知，再加一次纠偏。
 * 与动作上限绑在一起，保证「按任务提示正常规划」在结构上能完成一轮。
 */
export const DEFAULT_STAGE_MAX_ROUNDS = MAX_STAGE_NOTIFICATIONS_PER_TURN + 4;

/** world 的轮数上限：一次定位 + 全部写动作 + 提交 + 一次纠偏余量。 */
export const DEFAULT_WORLD_MAX_ROUNDS = MAX_WORLD_ACTIONS_PER_TURN + 3;

/** 外观推理 loop 的最大轮数。 */
export const DEFAULT_APPEARANCE_MAX_ROUNDS = 3;

/** 一次外观快照的最大字符数。 */
export const MAX_APPEARANCE_LENGTH = 300;

/** 掉落推理 loop 的最大轮数；只有一个终止工具，留一次纠偏。 */
export const DEFAULT_DROP_MAX_ROUNDS = 3;

/** 一具尸体一轮最多掉落的材料条数。 */
export const MAX_DROP_MATERIALS = 2;

/** 掉落材料名的最大字符数。 */
export const MAX_MATERIAL_NAME_LENGTH = 20;

/** 掉落材料描述的最大字符数。 */
export const MAX_MATERIAL_DESCRIPTION_LENGTH = 120;

/** 单条掉落材料的数量上限。 */
export const MAX_MATERIAL_COUNT = 10;

/** 结局标签的最大字符数：world 自己命名的短标签。 */
export const MAX_OUTCOME_LENGTH = 24;

/** 沟通类动作的 mind（第一人称内心独白）建议长度上限。 */
export const MAX_MIND_LENGTH = 60;

/** agent memory 中使用的稳定 kind 值。 */
export const MEMORY_KINDS = {
  actorSystemPrompt: "actor_system_prompt",
  actorOpeningBriefing: "actor_opening_briefing",
  compactedMemory: "compacted_memory",
  stageSystemPrompt: "stage_system_prompt",
  worldSystemPrompt: "world_system_prompt",
  stageObservation: "stage_observation",
  actionFeedback: "action_feedback",
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

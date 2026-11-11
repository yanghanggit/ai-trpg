import { MAX_STAGE_NOTIFICATIONS_PER_TURN, MAX_WORLD_ACTIONS_PER_TURN } from "./kernel/limits";

/**
 * 每个推理 loop 的默认轮数预算：调用点的 `maxRounds` 可以覆盖，不给就用这里的值。
 *
 * 与 `limits.ts` 是一对，按「能不能改」分：那边钉死配额，这边是可覆盖默认值——
 * 探针、调试与测试都会显式传别的值。stage 与 world 的预算由配额派生，配额一改
 * 预算跟着改，保证「按任务提示正常规划」在结构上能完成一轮。
 *
 * 每个常量只有一个消费者（它自己的 loop），集中在这里是为了横向对比：
 * 加一个新 loop 时能一眼看出它该拿几轮。
 */

/** actor 一回合理由推理 loop 的默认轮数。 */
export const DEFAULT_ACTOR_MAX_ROUNDS = 4;

/**
 * 舞台的轮数预算：environment + 锚点一次 + open_passage + 两条通知 +
 * submit_stage_plan，再加一次纠偏。
 */
export const DEFAULT_STAGE_MAX_ROUNDS = MAX_STAGE_NOTIFICATIONS_PER_TURN + 5;

/** world 的轮数预算：一次定位 + 全部写动作 + 提交 + 一次纠偏余量。 */
export const DEFAULT_WORLD_MAX_ROUNDS = MAX_WORLD_ACTIONS_PER_TURN + 3;

/** 外观推理 loop 的默认轮数：只有一个终止工具，留纠偏余量。 */
export const DEFAULT_APPEARANCE_MAX_ROUNDS = 3;

/** 掉落推理 loop 的默认轮数；只有一个终止工具，留一次纠偏。 */
export const DEFAULT_DROP_MAX_ROUNDS = 3;

/** 创作 loop（`story`）的默认轮数。 */
export const DEFAULT_STORY_MAX_ROUNDS = 10;

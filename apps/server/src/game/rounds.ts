import { MAX_STAGE_NOTIFICATIONS_PER_TURN, MAX_WORLD_ACTIONS_PER_TURN } from "./limits";

/**
 * 各推理 loop 的默认轮数预算：调用点的 `maxRounds` 可以覆盖，不给就用这里的值。
 *
 * 与 `limits.ts` 的分界是「能不能改」：配额是钉死的结算规则，这里的数是运行参数——
 * 探针、调试与测试都会显式传别的值。stage 与 world 的预算由配额派生，配额一改
 * 预算跟着改，保证「按任务提示正常规划」在结构上能完成一轮。
 */

/** actor 一回合理由推理 loop 的默认轮数。 */
export const DEFAULT_ACTOR_MAX_ROUNDS = 4;

/**
 * stage 小 GM 的轮数预算：environment + 锚点一次 + open_passage + 两条通知 +
 * submit_stage_plan，再加一次纠偏。
 */
export const DEFAULT_STAGE_MAX_ROUNDS = MAX_STAGE_NOTIFICATIONS_PER_TURN + 5;

/** world 的轮数预算：一次定位 + 全部写动作 + 提交 + 一次纠偏余量。 */
export const DEFAULT_WORLD_MAX_ROUNDS = MAX_WORLD_ACTIONS_PER_TURN + 3;

/** 外观推理 loop 的默认轮数；要额外请求变化简报时再加一轮。 */
export const DEFAULT_APPEARANCE_MAX_ROUNDS = 3;

/** 掉落推理 loop 的默认轮数；只有一个终止工具，留一次纠偏。 */
export const DEFAULT_DROP_MAX_ROUNDS = 3;

/** 创作 loop（`story`）的默认轮数。 */
export const DEFAULT_STORY_MAX_ROUNDS = 10;

/**
 * 框架钉死的上限：这些数改了就是改玩法，不是配置。
 *
 * 两种上限，都是「写进工具契约的那个数」：每回合能结算多少（提示词说「本轮最多几次」、
 * 暂存期拒绝超额、落账期再复查一遍，三处必须同值），以及模型的容量（舞台锚点、
 * 一次执行记几条后果，schema 与运行时共用同一个值）。
 *
 * 没有建局参数或环境变量能改它们；可被调用点覆盖的默认轮数在 `default-rounds.ts`。
 */

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

/** 一轮 stage 最多进行的锚点增删改条数：锚点变化是舞台级事实，一轮一改。 */
export const MAX_STAGE_ANCHOR_WRITES_PER_TURN = 1;

/** 一个舞台最多保留的可交互锚点数：舞台模型自身的容量，schema 与运行时共用。 */
export const MAX_STAGE_ANCHORS = 8;

/** 词缀 agent 一次执行最多记录几条可见后果。 */
export const MAX_AFFIX_WITNESSES = 2;

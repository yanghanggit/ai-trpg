/**
 * 回合作业的读法从契约包来：终态、失败码与结果形状只有一份。
 *
 * 这里保留一个薄薄的再导出，是因为换成 `@ai-trpg/api-client` 的路径不值得动一堆 import。
 */
export {
  isTerminalJob,
  outcomeOf,
  type TurnJob,
  TurnJobFailure,
  type TurnOutcome,
} from "@ai-trpg/api-client";

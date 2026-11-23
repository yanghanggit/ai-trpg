/**
 * 服务端可驱动的操作：CLI 与 HTTP 共用的唯一编排层。
 *
 * `play` 建局 / 读状态 / 接管 / 玩家动作 / 回合；`inspect` 探针与记忆；
 * `artifacts` 写文件的调试产物。传输层只负责参数与错误，不重复编排。
 */

export * from "./artifacts";
export * from "./inspect";
export * from "./play";
export * from "./player-action";
export * from "./services";
export * from "./trace";
export * from "./view";

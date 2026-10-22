/**
 * DeepSeek 通讯层错误模型（实现层别名）。
 *
 * 错误类型本身与 provider 无关，定义在 `llm/errors.ts`；这里保留 `DeepSeekError`
 * 这个名字，使调用方可以按 provider 导入，而 `DeepSeekError === ChatError`。
 */

export { ChatError, ChatError as DeepSeekError, type ErrorKind } from "../llm/errors";

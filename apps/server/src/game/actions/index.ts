import type { ActionKind } from "../types";

/** 全部动作 kind；顺序与提示词里的列举保持一致，供测试与文档引用。 */
export const ACTION_KINDS = [
  "say",
  "whisper",
  "announce",
  "move",
  "wait",
  "attack",
  "steal",
  "give",
  "pickup",
  "use",
] as const satisfies readonly ActionKind[];

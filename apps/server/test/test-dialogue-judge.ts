import type { DialogueJudge } from "../src/game/dialogue-audit";

/** 大多数测试只验证对话动作本身；这里显式放行，避免打真实审核 API。 */
export const allowAllDialogue: DialogueJudge = async () => ({
  allowed: true,
  categories: [],
  reason: "测试放行",
});

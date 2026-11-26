/**
 * 把「现在第几轮」接到阶段回调上。
 *
 * 一轮一次模型调用，这是 planner 循环能给出的最细粒度；三个回合层共用这一句，
 * 免得每个 `agentLoop` 调用点各写一遍同样的 lambda。
 */

import type { TurnStepReporter } from "../kernel/types";

export function roundProgress(onStep: TurnStepReporter | undefined): {
  onRound?: (round: number, maxRounds: number) => void;
} {
  if (onStep === undefined) {
    return {};
  }
  return {
    onRound: (round: number, maxRounds: number) => {
      onStep("planning", `第 ${round}/${maxRounds} 轮`);
    },
  };
}

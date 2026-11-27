import { roundComplete } from "@ai-trpg/api-client";
import type { GameGraph } from "../../features/games/useGameGraph";

/** 推进面板要摆出来的读数：全部由顺位与图谱导出来，不在界面里另算一遍。 */
export type AdvanceReadings = {
  hasOrder: boolean;
  /** 下一位；顺位上没有活人时为 null。 */
  next: { position: number; actorName: string; player: boolean } | null;
  /** 活人各自的已过回合数，按名次排。 */
  counts: number[];
  /** 活人计数齐平（且不是全零）：这一轮人人都动过了。 */
  complete: boolean;
  /** 下一位现在所在的舞台；认不出就是 undefined。 */
  nextStage?: string;
  /** 编排能不能自己走：有顺位、有下一位、且不是玩家席位。 */
  chainAllowed: boolean;
};

/**
 * 从图谱里读出「下一步是什么」。
 *
 * 三件事各有出处：`next` 与 `counts` 来自服务端的顺位快照，`nextStage` 来自 actor 的站位，
 * `complete` 是按共用的 `roundComplete` 算的读数。界面只负责把它们摆出来。
 */
export function advanceReadings(graph: GameGraph | undefined): AdvanceReadings {
  const order = graph?.order ?? null;
  if (order === null) {
    return { hasOrder: false, next: null, counts: [], complete: false, chainAllowed: false };
  }
  const entries = order.entries.filter((entry) => entry.alive);
  const next = order.nextActor;
  const actor = next === null ? undefined : graph?.actors.find((item) => item.id === next.actorId);
  const stage = graph?.stages.find((item) => item.id === actor?.stageId);
  return {
    hasOrder: true,
    next:
      next === null
        ? null
        : { position: next.position, actorName: next.actorName, player: next.control === "player" },
    counts: entries.map((entry) => entry.turnsTaken),
    complete: roundComplete(order),
    ...(stage === undefined ? {} : { nextStage: stage.name }),
    chainAllowed: next !== null && next.control !== "player",
  };
}

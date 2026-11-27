import { roundComplete } from "@ai-trpg/api-client";
import type { GameGraph } from "../../features/games/useGameGraph";

/** 编排表的一行：顺位上的一个名次，与它对应的舞台、以及这一行动轮的状态。 */
export type AdvanceRow = {
  actorId: string;
  actorName: string;
  position: number;
  control: "agent" | "player";
  alive: boolean;
  /** 这个角色在这一行动轮上已经落过账。 */
  actedThisRound: boolean;
  /** 他是这一行动轮里空过的（轮到过、没动手）。 */
  emptyThisRound: boolean;
  /** 他现在所在的舞台。 */
  stageId?: string;
  stageName?: string;
  /** 顺位上的下一位就是他。 */
  isNext: boolean;
};

/** 推进面板的读数：编排表 + 行动轮状态，全部由顺位、回合账与图谱导出来。 */
export type AdvanceReadings = {
  hasOrder: boolean;
  /** 这一局的世界名：world 行要写明是哪个世界在收尾。 */
  worldName?: string;
  /** 最近一笔账所属的行动轮编号；没有顺位时为 0。 */
  roundIndex: number;
  rows: AdvanceRow[];
  /** 这一行动轮的 world 回合推过没有。 */
  worldPushed: boolean;
  /** 活人计数齐平：这一轮人人都动过了。 */
  roundDone: boolean;
  /** 账上说这一轮 world 推过：这一轮已经收尾。 */
  roundClosed: boolean;
  /** 点了会被拦住的原因；没有就是能点。 */
  blocked?: string;
  /** 下一次点击会做什么，一句话。 */
  nextStep: string;
};

/**
 * 从图谱与行动轮读出「这一轮怎么走」。
 *
 * 三件事各有出处：`rows` 来自顺位（名次是权威的），`stageName` 来自 actor 的摊位，
 * `actedThisRound` / `worldPushed` 来自回合账——后者是此前只能拿「齐平」去猜的那一层。
 *
 * 按钮能不能点与「会做什么」是两件事：顺位上没人时按钮仍然能点，那一下是收工。
 */
export function advanceReadings(
  graph: GameGraph | undefined,
  round: GameGraph["round"] | undefined,
): AdvanceReadings {
  const order = graph?.order ?? null;
  if (order === null) {
    return {
      hasOrder: false,
      roundIndex: 0,
      rows: [],
      worldPushed: false,
      roundDone: false,
      roundClosed: false,
      nextStep: "开一条顺位",
    };
  }

  const acted = new Map<string, boolean>();
  for (const row of round?.actors ?? []) {
    acted.set(row.actorId, row.empty);
  }
  const next = order.nextActor;
  const rows: AdvanceRow[] = order.entries.map((entry) => {
    const actor = graph?.actors.find((item) => item.id === entry.actorId);
    const stage = graph?.stages.find((item) => item.id === actor?.stageId);
    return {
      actorId: entry.actorId,
      actorName: entry.actorName,
      position: entry.position,
      control: entry.control,
      alive: entry.alive,
      actedThisRound: acted.has(entry.actorId),
      emptyThisRound: acted.get(entry.actorId) === true,
      ...(stage === undefined ? {} : { stageId: stage.id, stageName: stage.name }),
      isNext: next !== null && next.actorId === entry.actorId,
    };
  });

  const roundDone = roundComplete(order);
  const worldPushed = round?.world ?? false;
  const nextStage = rows.find((row) => row.isNext)?.stageName;
  const worldPending = roundDone && !worldPushed;

  const blocked =
    next === null
      ? undefined
      : next.control === "player"
        ? `轮到 ${next.actorName}：玩家席位由玩家端自己决定`
        : undefined;

  const nextStep =
    next === null
      ? "收工（顺位上没有活着的人）"
      : blocked !== undefined
        ? "停在玩家席位"
        : worldPending
          ? `world 回合（收尾第 ${round?.index ?? 1} 轮）`
          : `NPC ${next.actorName} → 舞台 ${nextStage ?? "（认不出）"}${
              worldPending ? " → world 回合" : ""
            }`;

  return {
    hasOrder: true,
    ...(graph?.world.name === undefined ? {} : { worldName: graph.world.name }),
    roundIndex: round?.index ?? 1,
    rows,
    worldPushed,
    roundDone,
    roundClosed: roundDone && worldPushed,
    ...(blocked === undefined ? {} : { blocked }),
    nextStep,
  };
}

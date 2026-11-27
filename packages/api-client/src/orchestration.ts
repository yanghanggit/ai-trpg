/**
 * 编排：一次推进要走哪几步。
 *
 * 服务器只拥有四层单层入口与顺位快照，次序刻意留给客户端（`docs/action-order.md`）：
 * 推完一个 actor，再推它所在的舞台；活人计数齐平之后才推 world；遇到玩家席位就停手。
 * 这份次序是玩家端与管理后台共用的同一份——两边各写一遍，同一条顺位就会走出不同结果。
 *
 * 本模块不认识网络：三件事（读顺位、读舞台名单、跑一个回合）由调用方以 `AdvancePort`
 * 注入，两个 app 各给自己的实现。
 */

import type { components, paths } from "./schema";
import { isTerminalJob, outcomeOf, type TurnJob, TurnJobFailure } from "./turn-job";

export type ActionOrder = components["schemas"]["ActionOrder"];

/** 一个舞台的在场名单：定位用 id，名字只用来显示。 */
export type StageRoster = components["schemas"]["GameStageMap"]["stages"][number];

/** 行动轮：本轮的进度读数（谁落过账、哪些舞台推过、world 推过没有）。 */
export type ActionOrderRound = components["schemas"]["ActionOrderRound"];

/** 玩家动作的请求体：契约里那份可判别联合，调用方不必再抄一遍。 */
export type PlayerAction = paths["/api/v1/games/{game}/actors/{actor}/actions"]["post"] extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body extends { action: infer Action }
    ? Action
    : never
  : never;

/** 一个回合的请求：四个入口各一种，调用方只负责把它们排成一次请求。 */
export type TurnRequest =
  | { kind: "npc"; actor: string; expectedVersion?: number }
  | { kind: "player"; actor: string; action: PlayerAction; expectedVersion?: number }
  | {
      kind: "stage";
      /** 舞台引用：编排给 id（服务端 id 与名字都收，名字重了会要求改 id）。 */
      stage: string;
      /** 只用来显示的舞台名：服务端不读它。 */
      stageName?: string;
      expectedVersion?: number;
    }
  | { kind: "world"; expectedVersion?: number };

export type Reader<T> = () => Promise<T>;

/** 一次编排要用到的三件事：读顺位、读舞台名单、跑一个回合。 */
export type AdvancePort = {
  readOrder: Reader<ActionOrder | null>;
  readStageMap: () => Promise<StageRoster[]>;
  runTurn: (request: TurnRequest) => Promise<TurnJob>;
};

export type AdvanceResult =
  | { kind: "no-order" }
  | { kind: "idle"; reason: string }
  | { kind: "player"; actorName: string }
  | { kind: "advanced"; steps: ("npc" | "stage" | "world")[] };

/** 这一轮是不是人人都动过：活人计数齐平，且不是全零（那是还没开始）。 */
export function roundComplete(
  order: { entries: { alive: boolean; turnsTaken: number }[] } | null,
): boolean {
  if (order === null) {
    return false;
  }
  const counts = order.entries.filter((entry) => entry.alive).map((entry) => entry.turnsTaken);
  if (counts.length === 0) {
    return false;
  }
  const first = counts[0] ?? 0;
  return first > 0 && counts.every((count) => count === first);
}

/**
 * 这个 actor 现在在哪个舞台：舞台回合推的是「他移动之后所在的那一处」。
 *
 * 按 id 找，不按名字：同名角色分处两个舞台是可能的，按名字取第一个会推到别人的舞台去。
 */
export function stageOfActor(stages: StageRoster[], actorId: string): StageRoster | undefined {
  return stages.find((stage) => stage.actors.some((actor) => actor.id === actorId));
}

/** 视图过期是我们自己簿记的错：重读一次就能继续，不是这一回合的失败。 */
function isStaleView(error: unknown): boolean {
  return error instanceof TurnJobFailure && error.code === "stale_view";
}

/**
 * 推进一步。
 *
 * 一次只推一个 actor，然后推**他动手时所在的那个舞台**；这一轮人人动过之后推 world。
 * 遇到玩家席位就停下，把决定交回界面——引擎不替人做选择。
 *
 * 视图过期就重读重算一次：调用方手里那份顺位可能是几秒前的，那是编排的簿记问题，
 * 不该让「推进一步」这个动作莫名其妙地失败。
 */
export async function advanceOnce(
  port: AdvancePort,
  options: { retryOnStale?: boolean } = {},
): Promise<AdvanceResult> {
  try {
    return await advanceStep(port);
  } catch (error) {
    if (options.retryOnStale === false || !isStaleView(error)) {
      throw error;
    }
    return await advanceStep(port);
  }
}

async function advanceStep(port: AdvancePort): Promise<AdvanceResult> {
  const order = await port.readOrder();
  if (order === null) {
    return { kind: "no-order" };
  }
  const next = order.nextActor;
  if (next === null) {
    return { kind: "idle", reason: "顺位没有下一位" };
  }
  if (next.control === "player") {
    return { kind: "player", actorName: next.actorName };
  }

  // 舞台名单要在这一回合**之前**读：move 会当场落账，推完再读就是他到达的那个舞台了，
  // 而该反应的是「他在哪动的手」（A 的人听到动静、A 的锚点被动过），不是「他到了哪」（B）。
  const stage = stageOfActor(await port.readStageMap(), next.actorId);

  await port.runTurn({
    kind: "npc",
    actor: next.actorName,
    expectedVersion: order.gameVersion,
  });
  const steps: ("npc" | "stage" | "world")[] = ["npc"];

  if (stage !== undefined) {
    // 不再带视图版本：上一回合已经改过世界，旧版本必然过期。
    await port.runTurn({ kind: "stage", stage: stage.id, stageName: stage.name });
    steps.push("stage");
  }

  if (roundComplete(await port.readOrder())) {
    await port.runTurn({ kind: "world" });
    steps.push("world");
  }
  return { kind: "advanced", steps };
}

/**
 * 轮询一个作业直到终态；失败按作业留下的错误码抛出。
 *
 * 与编排放在一起，是因为两边都要它，而它的口径只有一条：入队不等于回合发生过，
 * 结果只认终态。
 */
export async function waitForTurnJob(
  job: TurnJob,
  read: (jobId: string) => Promise<TurnJob>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<TurnJob> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const intervalMs = options.intervalMs ?? 400;
  let current = job;
  while (!isTerminalJob(current)) {
    if (Date.now() > deadline) {
      throw new Error(`回合超时：${job.jobId}（当前 ${current.status}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await read(job.jobId);
  }
  const outcome = outcomeOf(current);
  if (!outcome.ok) {
    throw new TurnJobFailure(outcome.code, outcome.message);
  }
  return current;
}

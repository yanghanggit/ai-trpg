import { unwrap } from "@ai-trpg/api-client";
import { api } from "../../api/client";
import type { ActionOrder } from "../action-order/useActionOrder";
import { enqueueTurn, fetchTurnJob, type TurnRequest } from "./api";
import { isTerminalJob, outcomeOf, type TurnJob, TurnJobFailure } from "./turnJob";

export type Reader<T> = () => Promise<T>;

/** 一次编排要用到的三件事：读顺位、读舞台名单、跑一个回合。 */
export type AdvancePort = {
  readOrder: Reader<ActionOrder | null>;
  readStageMap: () => Promise<Record<string, string[]>>;
  runTurn: (request: TurnRequest) => Promise<TurnJob>;
};

export type AdvanceResult =
  | { kind: "no-order" }
  | { kind: "idle"; reason: string }
  | { kind: "player"; actorName: string }
  | { kind: "advanced"; steps: ("npc" | "stage" | "world")[] };

async function readStageMap(game: string): Promise<Record<string, string[]>> {
  return unwrap(await api.GET("/api/v1/games/{game}/stage-map", { params: { path: { game } } }))
    .stages;
}

/** 入队一个回合并等到终态；失败按作业留下的错误码抛出。 */
export async function runTurnAndWait(
  game: string,
  request: TurnRequest,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<TurnJob> {
  const job = await enqueueTurn(game, request);
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const intervalMs = options.intervalMs ?? 400;
  let current = job;
  while (!isTerminalJob(current)) {
    if (Date.now() > deadline) {
      throw new Error(`回合超时：${job.jobId}（当前 ${current.status}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await fetchTurnJob(game, job.jobId);
  }
  const outcome = outcomeOf(current);
  if (!outcome.ok) {
    throw new TurnJobFailure(outcome.code, outcome.message);
  }
  return current;
}

/** 把 `game` 注进上面的三个读法，得到一次编排真正用的端口。 */
export function createAdvancePort(game: string): AdvancePort {
  return {
    readOrder: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/action-orders/current", {
          params: { path: { game } },
        }),
      ).order,
    readStageMap: () => readStageMap(game),
    runTurn: (request) => runTurnAndWait(game, request),
  };
}

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

/** 名字 → 舞台：舞台回合要推「这个 actor 现在在哪」。 */
export function stageOfActor(
  stages: Record<string, string[]>,
  actorName: string,
): string | undefined {
  return Object.keys(stages).find((stage) => stages[stage]?.includes(actorName));
}

/** 视图过期是我们自己簿记的错：重读一次就能继续，不是这一回合的失败。 */
function isStaleView(error: unknown): boolean {
  return error instanceof TurnJobFailure && error.code === "stale_view";
}

/**
 * 推进一步。
 *
 * 一次只推一个 actor，然后推它所在的舞台；这一轮人人动过之后推 world。
 * 遇到玩家席位就停下，把决定交回界面——引擎不替人做选择。
 *
 * 视图过期就重读重算一次：客户端手里那份顺位可能是几秒前的，那是编排的簿记问题，
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

  await port.runTurn({
    kind: "npc",
    actor: next.actorName,
    expectedVersion: order.gameVersion,
  });
  const steps: ("npc" | "stage" | "world")[] = ["npc"];

  // 移动过的 actor 已经换了舞台：舞台名单要在这回合之后读。
  const stage = stageOfActor(await port.readStageMap(), next.actorName);
  if (stage !== undefined) {
    // 不再带视图版本：上一回合已经改过世界，旧版本必然过期。
    await port.runTurn({ kind: "stage", stage });
    steps.push("stage");
  }

  if (roundComplete(await port.readOrder())) {
    await port.runTurn({ kind: "world" });
    steps.push("world");
  }
  return { kind: "advanced", steps };
}

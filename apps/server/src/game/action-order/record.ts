import type { Database } from "../../db/pool";
import type { ActionOrderState } from "../kernel/types";
import {
  type ActionOrderTurnDraft,
  appendActionOrderTurn,
  findActiveActionOrder,
  incrementActionOrderEntry,
  readActorForLedger,
} from "../persistence/action-orders";
import { advanceGameClock, readGameClock } from "../persistence/games";
import type { Executor } from "../persistence/rows";

/**
 * 顺位上的两个记录口：计数（`entries.turns_taken`）与回合账（`action_order_turns`）。
 *
 * 两者都静默跳过：没有进行中的顺位、或这人不在顺位上（开这条顺位之后才加入世界），
 * 都只是「没记上」，不能反过来影响回合本身。顺位是记录，不是回合的前置条件。
 */

/** 一次推进的对账三元组：顺位期望的名次、实际推的名次、是否一致。不在顺位上就是空。 */
export type TurnDispatchFacts = {
  expectedPosition: number | null;
  actualPosition: number | null;
  followed: boolean | null;
};

/** 从回合之前读到的那份顺位算出对账三元组：判据只有名次，不看别的。 */
export function dispatchFacts(order: ActionOrderState, actorId: string): TurnDispatchFacts {
  const actual = order.entries.find((entry) => entry.actorId === actorId);
  const expected = order.nextActor;
  return {
    expectedPosition: expected === null ? null : expected.position,
    actualPosition: actual === undefined ? null : actual.position,
    followed:
      expected === null || actual === undefined ? null : expected.position === actual.position,
  };
}

/**
 * 记一个回合：这个 actor 的回合已经过去（有行动落账，或调用方明示空回合），顺位上 +1。
 *
 * 计数与账一起写：账上多一行，才知道这一行动轮他推过了；`pass` 也是他的一回合，
 * 只是 `empty` 由层次本身表达。
 */
export async function recordTurnTaken(
  executor: Executor,
  gameId: string,
  actorId: string,
  options: { kind?: "actor" | "pass"; facts?: TurnDispatchFacts } = {},
): Promise<boolean> {
  const order = await findActiveActionOrder(executor, gameId);
  if (!order) {
    return false;
  }
  const counted = await incrementActionOrderEntry(executor, order.id, actorId);
  const actor = await readActorForLedger(executor, actorId);
  if (actor !== undefined) {
    const facts = options.facts;
    const draft: ActionOrderTurnDraft = {
      kind: options.kind ?? "actor",
      subjectId: actorId,
      subjectName: actor.name,
      stageId: actor.stageId,
      clock: await readGameClock(executor, gameId),
      expectedPosition: facts?.expectedPosition ?? null,
      actualPosition: facts?.actualPosition ?? null,
      followed: facts?.followed ?? null,
    };
    await appendActionOrderTurn(executor, order.id, draft);
  }
  return counted;
}

/**
 * 空回合的唯一落账点：时间前进一格，再给顺位计数加一。
 *
 * 两件事一起做，因为它们描述同一个事实「这一回合过去了」；没有进行中的顺位时只推进时间，
 * 计数仍然只是「没记上」。与有动作的回合同一口径：时间在落账时前进。
 */
export async function recordPassTurn(
  db: Database,
  gameId: string,
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await advanceGameClock(tx, gameId);
    return recordTurnTaken(tx, gameId, actorId, { kind: "pass" });
  });
}

/**
 * 舞台回合落账后记一笔：这一行动轮，这个舞台推过了。
 *
 * 舞台没有名次，所以不记对账三元组；它记的是「这一回合发生过」，与 `stage-turn` 的
 * 落账在同一个事务里。
 */
export async function recordStageTurn(
  executor: Executor,
  gameId: string,
  stage: { id: string; name: string },
): Promise<void> {
  const order = await findActiveActionOrder(executor, gameId);
  if (!order) {
    return;
  }
  await appendActionOrderTurn(executor, order.id, {
    kind: "stage",
    subjectId: stage.id,
    subjectName: stage.name,
    stageId: stage.id,
    clock: await readGameClock(executor, gameId),
  });
}

/**
 * 世界回合落账后记一笔。
 *
 * 这一行同时是行动轮的分界：下一笔角色回合进下一轮。所以「这一轮 world 推过没有」
 * 从此是一条可读的事实，不用再拿「活人计数齐平」去猜。
 */
export async function recordWorldTurn(
  executor: Executor,
  gameId: string,
  worldName: string,
): Promise<void> {
  const order = await findActiveActionOrder(executor, gameId);
  if (!order) {
    return;
  }
  await appendActionOrderTurn(executor, order.id, {
    kind: "world",
    subjectId: "world",
    subjectName: worldName,
    clock: await readGameClock(executor, gameId),
  });
}

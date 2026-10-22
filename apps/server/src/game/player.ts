import type { Database } from "../db/pool";
import type { CommunicationActionType } from "./actions";
import { findActor } from "./actors";
import { applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { getGameState } from "./service";
import type { ActorPlan, ActorTurnResult } from "./types";

export type PlayerCommunicationMode = CommunicationActionType;

export type PlayerCommunicationInput = {
  mode: PlayerCommunicationMode;
  message: string;
  targetActorName?: string;
  reason?: string;
};

export type PlayerAttackInput = {
  targetActorName: string;
};

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
async function applyPlayerPlan(
  db: Database,
  gameRef: string,
  actorRef: string,
  plan: ActorPlan,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const ok = await applyActorPlan(db, state.game.id, actor.id, plan, [], true);
  if (!ok) {
    throw new GameError("invalid_action", "玩家行动被拒绝");
  }

  return {
    ok: true,
    plan,
    loopSuccess: true,
    state: await getGameState(db, state.game.id),
  };
}

/**
 * 玩家直接提交一次沟通行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerCommunicate(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerCommunicationInput,
): Promise<ActorTurnResult> {
  const plan: ActorPlan = {
    intents: [
      {
        kind: "communication",
        mind: input.reason?.trim() || "玩家直接提交",
        mode: input.mode,
        ...(input.targetActorName !== undefined ? { targetActorName: input.targetActorName } : {}),
        message: input.message,
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

/**
 * 玩家直接提交一次攻击行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerAttack(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerAttackInput,
): Promise<ActorTurnResult> {
  const plan: ActorPlan = {
    intents: [{ kind: "attack", targetActorName: input.targetActorName }],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

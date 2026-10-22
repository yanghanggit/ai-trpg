import type { Database } from "../db/pool";
import type { SpeechActionType } from "./actions";
import { findActor } from "./actors";
import { applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { getGameState } from "./service";
import type { ActorActionPlan, ActorTurnResult } from "./types";

export type PlayerSpeechMode = SpeechActionType;

export type PlayerSpeechInput = {
  mode: PlayerSpeechMode;
  message: string;
  targetActorName?: string;
  reason?: string;
};

/**
 * 玩家直接提交一次说话行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerSpeak(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerSpeechInput,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const plan: ActorActionPlan = {
    mind: input.reason?.trim() || "玩家直接提交",
    actionType: input.mode,
    ...(input.targetActorName !== undefined ? { targetActorName: input.targetActorName } : {}),
    message: input.message,
  };

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

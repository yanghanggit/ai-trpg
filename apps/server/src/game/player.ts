import type { Database } from "../db/pool";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { applyActorPlan } from "./npc";
import { getGameState } from "./service";
import type { ActorState, NpcPlan, NpcTurnResult } from "./types";

export type PlayerSpeechMode = "say" | "whisper" | "announce";

export type PlayerSpeechInput = {
  mode: PlayerSpeechMode;
  message: string;
  targetActorName?: string;
};

function findActor(state: Awaited<ReturnType<typeof getGameState>>, ref: string): ActorState {
  const matches = state.world.stages
    .flatMap((stage) => stage.actors)
    .filter((actor) => actor.id === ref || actor.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一，请使用 id: ${ref}`);
  }
  return matches[0] as ActorState;
}

export async function playerSpeak(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerSpeechInput,
): Promise<NpcTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }
  if (input.message.trim().length === 0) {
    throw new GameError("invalid_action", "玩家发言不能为空");
  }
  if ((input.mode === "say" || input.mode === "whisper") && !input.targetActorName) {
    throw new GameError("invalid_action", `${input.mode} 需要 targetActorName`);
  }

  const plan: NpcPlan = {
    mind: "玩家接管发言。",
    actionType: input.mode,
    ...(input.targetActorName !== undefined ? { targetActorName: input.targetActorName } : {}),
    message: input.message,
  };

  const ok = await applyActorPlan(db, state.game.id, actor.id, plan, [], true);
  if (!ok) {
    throw new GameError("invalid_action", "玩家发言被拒绝");
  }

  return {
    ok: true,
    plan,
    loopSuccess: true,
    state: await getGameState(db, state.game.id),
  };
}

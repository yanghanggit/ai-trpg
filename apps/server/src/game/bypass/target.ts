import type { Database } from "../../db/pool";
import { findActorByName } from "../actor-state";
import { GameError } from "../errors";
import { getGameStateSlice } from "../game-state";
import { type LoadedMemory, loadAgentMemory } from "../memory";
import type { ActorState, GameStateSlice, StageState } from "../types";

/**
 * 一次旁路推理要读的全部东西：状态、当事人、所在场景、世界面名字表与它的记忆。
 *
 * 由旁路自己装配，而不是让调用方拼：借谁的记忆、守卫要哪些名字、游戏是否还在跑，
 * 都是这条能力自身的契约。调用方只需要拿到 `actor` 去组装自己的任务文本。
 */
export type MemoryTarget = {
  state: GameStateSlice;
  actor: ActorState;
  stage: StageState;
  /** 世界面守卫用的全量角色名：产出里不能出现名字与引用。 */
  actorNames: string[];
  memory: LoadedMemory;
};

export async function loadMemoryTarget(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<MemoryTarget> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const { actor, stage } = findActorByName(state, actorRef);
  const actorNames = state.world.stages.flatMap((candidate) =>
    candidate.actors.map((present) => present.name),
  );
  const memory = await loadAgentMemory(db, state.game.id, "actor", actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${actor.name}`);
  }
  return { state, actor, stage, actorNames, memory };
}

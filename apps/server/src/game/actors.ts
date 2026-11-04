import assert from "node:assert/strict";
import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./edges";
import { GameError } from "./errors";
import type { ActorState, GameStateSlice, StageState } from "./types";

export type ActorWithStage = {
  actor: ActorState;
  stage: StageState;
};

export function allActors(state: GameStateSlice): ActorWithStage[] {
  return state.world.stages.flatMap((stage) => stage.actors.map((actor) => ({ actor, stage })));
}

/**
 * actor 检索只保留两种语义入口：这里的真名，以及 `apply/queries.ts` 的签名。
 * id 是控制面的稳定身份，不作为 actor-facing 的检索键。
 */

/** 按真名定位；名字重复时直接拒绝，不退回 id 或编号。 */
export function findActorByName(state: GameStateSlice, name: string): ActorWithStage {
  const matches = allActors(state).filter(({ actor }) => actor.name === name);
  if (matches.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${name}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一: ${name}`);
  }
  const [match] = matches;
  assert(match, `actor 定位结果为空: ${name}`);
  return match;
}

/** 按签名序号定位；只用于玩家 god-view 的 `#编号` 入口。 */
export function findActorBySignatureSeq(state: GameStateSlice, seq: number): ActorWithStage {
  const matches = allActors(state).filter(({ actor }) => actor.signature.seq === seq);
  if (matches.length === 0) {
    throw new GameError("not_found", `签名不存在: #${seq}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_state", `签名序号不唯一: #${seq}`);
  }
  const [match] = matches;
  assert(match, `签名定位结果为空: #${seq}`);
  return match;
}

export function otherActorsInStage(stage: StageState, actorId: string): ActorState[] {
  return stage.actors.filter((actor) => actor.id !== actorId);
}

/** 只走已通行的边。 */
export function adjacentStages(state: GameStateSlice, stageId: string): StageState[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return openNeighborIds(edges, stageId)
    .map((id) => byId.get(id))
    .filter((stage): stage is StageState => stage !== undefined);
}

/** 返回从指定场景可直接到达的场景名。 */
export function adjacentStageNames(state: GameStateSlice, stageId: string): string[] {
  return adjacentStages(state, stageId).map((stage) => stage.name);
}

/** 剧情上相连、但当前不可通过的场景；供 stage 小 GM 判断能否 open_passage。 */
export function sealedStageNames(state: GameStateSlice, stageId: string): string[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return sealedNeighborIds(edges, stageId).flatMap((id) => {
    const stage = byId.get(id);
    return stage ? [stage.name] : [];
  });
}

/**
 * god-view 解析：真名、`@真名` 或 `#签名序号` → actor。
 *
 * 玩家入口、开发期命令都用这一份；模型工具只拿得到 actor-facing 引用。
 */
export function findActorByRef(state: GameStateSlice, ref: string): ActorState {
  const value = ref.trim();
  if (value.startsWith("#")) {
    const seq = Number(value.slice(1));
    if (!Number.isInteger(seq) || seq <= 0) {
      throw new GameError("not_found", `没有这个引用: ${value}`);
    }
    return findActorBySignatureSeq(state, seq).actor;
  }
  const name = value.startsWith("@") ? value.slice(1) : value;
  return findActorByName(state, name).actor;
}

export function findStage(state: GameStateSlice, ref: string): StageState {
  const matches = state.world.stages.filter((stage) => stage.id === ref || stage.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `场景不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `场景名称不唯一，请使用 id: ${ref}`);
  }
  const [match] = matches;
  assert(match, `场景定位结果为空: ${ref}`);
  return match;
}

export function findStageByName(state: GameStateSlice, name: string): StageState | undefined {
  return state.world.stages.find((stage) => stage.name === name);
}

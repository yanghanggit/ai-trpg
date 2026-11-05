import assert from "node:assert/strict";
import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./edges";
import { GameError } from "./errors";
import { isHandleRef, parseHandle, stripNameRef } from "./reference";
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

/** 从 actor 定位他所在的场景；同一 actor 出现在两个场景是状态错误。 */
export function stageOfActor(state: GameStateSlice, actorId: string): ActorWithStage {
  const matches = allActors(state).filter(({ actor }) => actor.id === actorId);
  if (matches.length === 0) {
    throw new GameError("invalid_state", `actor 不属于任何场景: ${actorId}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_state", `actor 同时出现在多个场景: ${actorId}`);
  }
  const [match] = matches;
  assert(match, `actor 场景定位结果为空: ${actorId}`);
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
export function sealedStages(state: GameStateSlice, stageId: string): StageState[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return sealedNeighborIds(edges, stageId).flatMap((id) => {
    const stage = byId.get(id);
    return stage ? [stage] : [];
  });
}

export function sealedStageNames(state: GameStateSlice, stageId: string): string[] {
  return sealedStages(state, stageId).map((stage) => stage.name);
}

/**
 * god-view 解析：真名、`@真名`（兼容旧写法）或 `#签名序号` → actor。
 *
 * 玩家入口、开发期命令都用这一份；模型工具只拿得到 actor-facing 引用。
 */
export function findActorByRef(state: GameStateSlice, ref: string): ActorState {
  const value = ref.trim();
  if (isHandleRef(value)) {
    const seq = parseHandle(value);
    if (seq === null) {
      throw new GameError("not_found", `没有这个引用: ${value}`);
    }
    return findActorBySignatureSeq(state, seq).actor;
  }
  return findActorByName(state, stripNameRef(value)).actor;
}

/**
 * 按场景真名定位：`#序号` 与 id 一律不算名字。
 *
 * 「能指名」是种权利而不是便利：`#序号` 只表示看得见、还没命名的站位，一旦允许它
 * 充当名字，路过的站位就会倒过来变成地名知识。问路的端点走这里；
 * 移动的目标不走——走向一扇看得见的门本来就只需要编号。
 */
export type StageNameResolution =
  | { ok: true; stage: StageState }
  | { ok: false; reason: "empty" | "handle_ref" | "unknown_stage" | "ambiguous" };

/** 非抛错版本：调用方要把「解析不到」当结果回话（例如问路）时使用。 */
export function resolveStageName(state: GameStateSlice, ref: string): StageNameResolution {
  const name = stripNameRef(ref.trim());
  if (name.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (isHandleRef(name)) {
    return { ok: false, reason: "handle_ref" };
  }
  const matches = state.world.stages.filter((stage) => stage.name === name);
  if (matches.length === 0) {
    return { ok: false, reason: "unknown_stage" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }
  const [match] = matches;
  assert(match, `场景定位结果为空: ${name}`);
  return { ok: true, stage: match };
}

/** 必须按场景真名定位：`#序号` 与 id 一律拒绝；解析失败抛 `GameError`。 */
export function requireStageName(state: GameStateSlice, ref: string): StageState {
  const name = stripNameRef(ref.trim());
  const resolved = resolveStageName(state, ref);
  if (resolved.ok) {
    return resolved.stage;
  }
  switch (resolved.reason) {
    case "empty":
      throw new GameError("invalid_action", "场景名不能为空");
    case "handle_ref":
      throw new GameError(
        "invalid_action",
        `必须用场景真名指定；#序号 只是看得见但还没命名的站位: ${name}`,
      );
    case "ambiguous":
      throw new GameError("invalid_action", `场景名称不唯一: ${name}`);
    case "unknown_stage":
      throw new GameError("not_found", `场景不存在: ${name}`);
  }
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

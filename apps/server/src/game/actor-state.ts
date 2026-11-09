import assert from "node:assert/strict";
import { isHandleRef, parseHandle } from "./addressing";
import { GameError } from "./errors";
import type { ActorState, GameStateSlice, StageState } from "./types";

/**
 * actor 的状态层定位：把引用解析成 `ActorState`（连同他所在的场景）。
 *
 * 与行级读写（`persistence/actors.ts`）分开：这里只看已装载的状态，不碰数据库。
 *
 * 检索只保留两种语义入口：真名（这里）与签名（`apply/queries.ts`）。
 * id 是控制面的稳定身份，不作为 actor-facing 的检索键——只有 `stageOfActor`
 * 与 god-view 的 `#编号` 走它。
 */

/** actor 与它所在场景：定位的结果总是成对出现，免得调用方再查一次。 */
export type ActorWithStage = {
  actor: ActorState;
  stage: StageState;
};

export function allActors(state: GameStateSlice): ActorWithStage[] {
  return state.world.stages.flatMap((stage) => stage.actors.map((actor) => ({ actor, stage })));
}

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

/** 按签名序号定位；god-view 的 `#编号` 引用最终落到这里。 */
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

/**
 * god-view 解析：真名或 `#签名序号` → actor。
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
  return findActorByName(state, value).actor;
}

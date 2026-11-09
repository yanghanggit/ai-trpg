import { allActors, findActorByName } from "../actor-state";
import type { MemoryOwnerType } from "../memory";
import { findStage } from "../stage-state";
import type { GameStateSlice } from "../types";
import type { CompactTarget } from "./types";

/**
 * 压缩主体的解析：把 actor / stage 的引用、或「全部」解析成稳定的 owner 三元组。
 *
 * `resolveAllOwners` 的顺序是固定的（world、各场景、各 actor）：批量压缩按这个顺序
 * 逐条跑，复盘时同一局的输出顺序可复现。
 */

type ResolvedOwner = {
  ownerType: MemoryOwnerType;
  ownerId: string;
  ownerName: string;
};

function resolveActorOwner(state: GameStateSlice, ref: string): ResolvedOwner {
  const current = findActorByName(state, ref);
  return { ownerType: "actor", ownerId: current.actor.id, ownerName: current.actor.name };
}

function resolveStageOwner(state: GameStateSlice, ref: string): ResolvedOwner {
  const stage = findStage(state, ref);
  return { ownerType: "stage", ownerId: stage.id, ownerName: stage.name };
}

function resolveWorldOwner(state: GameStateSlice): ResolvedOwner {
  return { ownerType: "world", ownerId: state.world.id, ownerName: state.world.name };
}

export function resolveTarget(state: GameStateSlice, target: CompactTarget): ResolvedOwner {
  switch (target.ownerType) {
    case "actor":
      return resolveActorOwner(state, target.ref);
    case "stage":
      return resolveStageOwner(state, target.ref);
    case "world":
      return resolveWorldOwner(state);
  }
}

export function resolveAllOwners(state: GameStateSlice): ResolvedOwner[] {
  return [
    resolveWorldOwner(state),
    ...state.world.stages.map((stage) => ({
      ownerType: "stage" as const,
      ownerId: stage.id,
      ownerName: stage.name,
    })),
    ...allActors(state).map(({ actor }) => ({
      ownerType: "actor" as const,
      ownerId: actor.id,
      ownerName: actor.name,
    })),
  ];
}

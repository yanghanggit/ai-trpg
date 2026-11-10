import { allActors, findActorByName } from "../actor-state";
import { GameError } from "../errors";
import { findStage } from "../stage-state";
import type { GameStateSlice } from "../types";
import { MEMORY_OWNER_TYPES, type MemoryOwnerType } from "./types";

/**
 * 记忆所有者的解析：调试入口的「类型 + 名字」、以及批量维护的「全部」。
 *
 * 解析只此一处：新增携带记忆的实体时，登记 `MEMORY_OWNER_TYPES` 并在这里补一个分支，
 * 各调试入口（记忆导出、compact）就不必各自维护一份清单。
 * actor 与 stage 走引擎自己的查找，名字不唯一直接报错，不做模糊匹配；world 一局唯一，不需要名字。
 */
export type MemoryOwnerRef = {
  ownerType: MemoryOwnerType;
  ownerId: string;
  name: string;
};

export function resolveMemoryOwner(
  state: GameStateSlice,
  ownerType: MemoryOwnerType,
  ref?: string,
): MemoryOwnerRef {
  const name = ref?.trim() ?? "";
  switch (ownerType) {
    case "actor": {
      if (name.length === 0) {
        throw new GameError("invalid_action", "memory --owner actor 需要 --name <actorName>");
      }
      const { actor } = findActorByName(state, name);
      return { ownerType, ownerId: actor.id, name: actor.name };
    }
    case "stage": {
      if (name.length === 0) {
        throw new GameError(
          "invalid_action",
          "memory --owner stage 需要 --name <stageId|stageName>",
        );
      }
      const stage = findStage(state, name);
      return { ownerType, ownerId: stage.id, name: stage.name };
    }
    case "world":
      return { ownerType, ownerId: state.world.id, name: state.world.name };
    default:
      throw new GameError(
        "invalid_action",
        `未知的记忆所有者类型: ${ownerType}；可用: ${MEMORY_OWNER_TYPES.join(" / ")}`,
      );
  }
}

/**
 * 一局全部记忆所有者，顺序固定：world → 各场景 → 各 actor。
 *
 * 批量维护（压缩、导出）按这个顺序逐条跑，复盘时同一局的输出顺序可复现。
 */
export function listMemoryOwners(state: GameStateSlice): MemoryOwnerRef[] {
  return [
    { ownerType: "world", ownerId: state.world.id, name: state.world.name },
    ...state.world.stages.map((stage) => ({
      ownerType: "stage" as const,
      ownerId: stage.id,
      name: stage.name,
    })),
    ...allActors(state).map(({ actor }) => ({
      ownerType: "actor" as const,
      ownerId: actor.id,
      name: actor.name,
    })),
  ];
}

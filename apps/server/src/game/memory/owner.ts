import { findActorByName } from "../actors";
import { GameError } from "../errors";
import { findStage } from "../stages";
import type { GameStateSlice } from "../types";
import { MEMORY_OWNER_TYPES, type MemoryOwnerType } from "./types";

/**
 * 把调试入口的「类型 + 名字」解析成记忆所有者的稳定 id。
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

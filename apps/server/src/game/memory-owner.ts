import { findActorByName, findStage } from "./actors";
import { GameError } from "./errors";
import type { MemoryOwnerType } from "./memory";
import type { GameStateSlice } from "./types";

/**
 * 记忆实体（拥有独立 memory 的实体 agent）的稳定集合。
 *
 * 目前只有 actor / stage / world 三类；新增记忆实体的同时在这里登记，
 * 调试入口（记忆导出、compact）就不必各自维护一份清单。
 */
export const MEMORY_OWNER_TYPES = [
  "actor",
  "stage",
  "world",
] as const satisfies readonly MemoryOwnerType[];

export type MemoryOwnerRef = {
  ownerType: MemoryOwnerType;
  ownerId: string;
  name: string;
};

export function isMemoryOwnerType(value: string): value is MemoryOwnerType {
  return (MEMORY_OWNER_TYPES as readonly string[]).includes(value);
}

/**
 * 把 CLI / 调试入口的 `--owner` + `--name` 解析成 stable id。
 *
 * actor 与 stage 的引用仍走引擎的查找函数：名字不唯一时直接报错，不做模糊匹配；
 * world 是一局唯一，不需要 name。
 */
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

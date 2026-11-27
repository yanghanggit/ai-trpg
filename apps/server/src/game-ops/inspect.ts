/**
 * 排查与维护：`probe` / `memory` / `name-leaks` / `compact`。
 *
 * 前三个是只读旁路，`compact` 是唯一会改记忆的入口。文件导出不在这里——
 * 记忆导出由调用方拿 `memory` 原文自己落盘，服务端只回答「记忆是什么」。
 */

import type { Database } from "../db/pool";
import {
  auditGameNameLeaks,
  type CompactMemoryResult,
  compactAllMemories,
  compactMemory,
  getGameState,
  getMemoryState,
  MEMORY_OWNER_TYPES,
  type ProbeResult,
  resolveMemoryOwner,
  runProbe,
} from "../game";
import type { ProbeTarget } from "../game/agents/probe";
import type { GameState } from "../game/kernel/types";
import type { AgentMemoryState, MemoryOwnerType } from "../game/memory";
import type { NameLeakReport } from "../game/name-audit";
import type { LlmServices } from "./services";

export type { MemoryOwnerType };
export { MEMORY_OWNER_TYPES };

export async function probeOp(
  db: Database,
  gameRef: string,
  input: { message: string; target: ProbeTarget },
  services: LlmServices,
): Promise<ProbeResult> {
  return runProbe(db, gameRef, {
    service: services.service,
    message: input.message,
    target: input.target,
  });
}

export type MemoryQuery =
  | { owner: "actor"; name: string }
  | { owner: "stage"; name: string }
  | { owner: "world" };

/** 一份记忆的读回：owner 是谁、局是什么、消息有哪些。 */
export type MemoryOpResult = {
  owner: ReturnType<typeof resolveMemoryOwner>;
  game: GameState["game"];
  memory: AgentMemoryState;
  messages: number;
};

/** 记忆原文：owner 解析只有一处，导出物由调用方决定写到哪。 */
export async function memoryOp(
  db: Database,
  gameRef: string,
  query: MemoryQuery,
): Promise<MemoryOpResult> {
  const state = await getGameState(db, gameRef);
  const owner = resolveMemoryOwner(
    state,
    query.owner,
    query.owner === "world" ? undefined : query.name,
  );
  const memory = await getMemoryState(db, state.game.id, owner.ownerType, owner.ownerId);
  if (!memory) {
    throw new Error(`缺少 memory: ${owner.ownerType} ${owner.name}`);
  }
  return {
    owner,
    game: state.game,
    memory,
    messages: memory.messages.length,
  };
}

export type NameLeakQuery = {
  scope?: "ever" | "current";
  allow?: string[];
  includeSystem?: boolean;
  since?: Date;
};

export async function nameLeaksOp(
  db: Database,
  gameRef: string,
  query: NameLeakQuery = {},
): Promise<{ report: NameLeakReport }> {
  const report = await auditGameNameLeaks(db, gameRef, {
    nameScope: query.scope === "current" ? "currentSignature" : "ever",
    ...(query.includeSystem ? { skipKinds: [] } : {}),
    ...(query.allow && query.allow.length > 0 ? { allowNames: query.allow } : {}),
    ...(query.since === undefined ? {} : { since: query.since }),
  });
  return { report };
}

export type CompactQuery =
  | { owner: "actor" | "stage"; name: string; minRatio?: number }
  | { owner: "world" | "all"; minRatio?: number };

export async function compactOp(
  db: Database,
  gameRef: string,
  query: CompactQuery,
  services: LlmServices,
): Promise<{ results: CompactMemoryResult[] }> {
  const options = {
    service: services.service,
    ...(query.minRatio === undefined ? {} : { minRatio: query.minRatio }),
  };
  if (query.owner === "all") {
    return { results: await compactAllMemories(db, gameRef, options) };
  }
  if (query.owner === "world") {
    return { results: [await compactMemory(db, gameRef, { ownerType: "world" }, options)] };
  }
  if (query.owner === "actor" || query.owner === "stage") {
    return {
      results: [
        await compactMemory(db, gameRef, { ownerType: query.owner, ref: query.name }, options),
      ],
    };
  }
  throw new Error(`未知的压缩目标: ${String(query)}`);
}

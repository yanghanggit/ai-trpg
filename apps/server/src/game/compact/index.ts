import type { Database } from "../../db/pool";
import { getGameStateSlice } from "../game-state";
import { listMemoryOwners, resolveMemoryOwner } from "../memory";
import { loadNameAuditInput } from "../persistence/name-audit";
import { compactResolvedMemory } from "./store";
import type { CompactMemoryOptions, CompactMemoryResult, CompactTarget } from "./types";

export { buildCompactionInput, buildCompactSystemPrompt } from "./prompt";
export type { CompactMemoryOptions, CompactMemoryResult, CompactTarget } from "./types";

/**
 * 手动压缩的入口：单主体与全量两条，共用同一份落账。
 *
 * 全量压缩只读一次名字审计输入：它在整轮里不变，逐条重查只是浪费。
 */
export async function compactMemory(
  db: Database,
  gameRef: string,
  target: CompactTarget,
  options: CompactMemoryOptions,
): Promise<CompactMemoryResult> {
  const state = await getGameStateSlice(db, gameRef);
  const owner = resolveMemoryOwner(
    state,
    target.ownerType,
    target.ownerType === "world" ? undefined : target.ref,
  );
  const auditInput =
    owner.ownerType === "actor" ? await loadNameAuditInput(db, state.game.id) : undefined;
  return compactResolvedMemory(db, state.game.id, state.world, owner, options, auditInput);
}

/** 全量压缩：按 world → 各场景 → 各 actor 的固定顺序逐条跑。 */
export async function compactAllMemories(
  db: Database,
  gameRef: string,
  options: CompactMemoryOptions,
): Promise<CompactMemoryResult[]> {
  const state = await getGameStateSlice(db, gameRef);
  const auditInput = await loadNameAuditInput(db, state.game.id);
  const results: CompactMemoryResult[] = [];
  for (const owner of listMemoryOwners(state)) {
    results.push(
      await compactResolvedMemory(db, state.game.id, state.world, owner, options, auditInput),
    );
  }
  return results;
}

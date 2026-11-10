import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { agentMemories, agentMemoryMessages, games } from "../../db/schema";
import { GameError } from "../errors";
import type { MemoryOwnerRef } from "../memory";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import type { NameAuditInput } from "../name-audit";
import type { WorldState } from "../types";
import { assertActorSummaryKnown } from "./audit";
import { summarizeMemory } from "./summarize";
import type { CompactMemoryOptions, CompactMemoryResult } from "./types";

/**
 * 压缩的落账：LLM 调用在事务外，事务内只做并发检查和写入。
 *
 * 压缩后 memory 回到 [system, human] 的闭环；旧消息不丢，作为 `compactedMessages`
 * 挂在新的摘要节点上，形成可回溯树。
 */

function validateMinRatio(minRatio: number | undefined): void {
  if (minRatio === undefined) {
    return;
  }
  if (!Number.isFinite(minRatio) || minRatio < 0 || minRatio > 1) {
    throw new GameError("invalid_action", "minRatio 必须在 0 到 1 之间");
  }
}

/**
 * 压缩后 memory 回到 [system, human] 的闭环；LLM 调用在事务外，事务内只做并发检查和落账。
 */
export async function compactResolvedMemory(
  db: Database,
  gameId: string,
  world: WorldState,
  owner: MemoryOwnerRef,
  options: CompactMemoryOptions,
  auditInput?: NameAuditInput,
): Promise<CompactMemoryResult> {
  validateMinRatio(options.minRatio);
  const memory = await loadAgentMemory(db, gameId, owner.ownerType, owner.ownerId);
  if (!memory) {
    throw new GameError("invalid_state", `记忆不存在: ${owner.name}`);
  }
  if (memory.messages[0]?.type !== "system") {
    throw new GameError("invalid_state", `memory 第一条不是 system: ${owner.name}`);
  }

  const beforeMessages = memory.messages.length;
  const contextUsageRatio = memory.row.contextUsageRatio;
  const base = {
    ownerType: owner.ownerType,
    ownerName: owner.name,
    contextUsageRatio,
    beforeMessages,
    afterMessages: beforeMessages,
  };

  if (beforeMessages <= 1) {
    return { ...base, skipped: true, reason: "没有可压缩记忆" };
  }
  if (options.minRatio !== undefined && contextUsageRatio < options.minRatio) {
    return {
      ...base,
      skipped: true,
      reason: `contextUsageRatio ${contextUsageRatio.toFixed(4)} 低于阈值 ${options.minRatio}`,
    };
  }

  const summary = await summarizeMemory(owner, memory.messages, options.service, world);
  if (owner.ownerType === "actor") {
    if (!auditInput) {
      throw new GameError("invalid_state", `缺少 actor 名字审计输入: ${owner.name}`);
    }
    assertActorSummaryKnown(auditInput, owner, summary);
  }
  const lastContent = memory.messages.at(-1)?.content;
  const beforeUpdatedAt = memory.row.updatedAt.getTime();

  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    const current = await loadAgentMemory(tx, gameId, owner.ownerType, owner.ownerId);
    if (!current) {
      throw new GameError("invalid_state", `记忆不存在: ${owner.name}`);
    }
    if (
      current.messages.length !== beforeMessages ||
      current.row.updatedAt.getTime() !== beforeUpdatedAt ||
      current.messages.at(-1)?.content !== lastContent
    ) {
      throw new GameError("invalid_state", `记忆在压缩期间发生变化，请重试: ${owner.name}`);
    }

    const compactedMessages = current.messages.slice(1);
    await tx
      .delete(agentMemoryMessages)
      .where(
        and(eq(agentMemoryMessages.memoryId, current.row.id), gte(agentMemoryMessages.sequence, 2)),
      );
    await appendMemoryMessages(tx, current.row.id, [
      {
        type: "human",
        content: `# 本局记忆\n\n${summary}`,
        metadata: {
          kind: MEMORY_KINDS.compactedMemory,
          /** 被这次 compact 吸收的旧消息；内含更早的 compact 节点，形成可回溯树。 */
          compactedMessages,
          compactedMessageCount: compactedMessages.length,
          contextUsageRatio,
          compactedAt: new Date().toISOString(),
        },
      },
    ]);
    await tx
      .update(agentMemories)
      .set({ contextUsageRatio: 0, updatedAt: new Date() })
      .where(eq(agentMemories.id, current.row.id));
  });

  return {
    ...base,
    skipped: false,
    afterMessages: 2,
    summary,
  };
}

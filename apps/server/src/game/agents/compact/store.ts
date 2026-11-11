import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../../../db/pool";
import { agentMemories, agentMemoryMessages, games } from "../../../db/schema";
import type { ChatMessage } from "../../../llm";
import { GameError } from "../../errors";
import type { WorldState } from "../../kernel/types";
import type { MemoryOwnerRef } from "../../memory";
import { appendMemoryMessages, loadAgentMemory } from "../../memory";
import { MEMORY_KINDS } from "../../memory/kinds";
import type { NameAuditInput } from "../../name-audit";
import { assertActorSummaryKnown } from "./audit";
import { summarizeMemory } from "./summarize";
import type { CompactMemoryOptions, CompactMemoryResult } from "./types";

/**
 * 压缩的落账：LLM 调用在事务外，事务内只做并发检查和写入。
 *
 * 压缩后 memory 回到 [system, human] 的闭环；旧消息不丢，作为 `compactedMessages`
 * 挂在新的摘要节点上，形成可回溯树。
 */

/**
 * 压缩后按原文回填的认知类别。
 *
 * 路线结论在结构里没有副本（名字有 `signatureNames`，路线只有这一段记忆），被摘要改写
 * 就等于丢了「某地怎么走、哪个地名认不认得」。摘要由模型写，不保证逐字保住，所以这里
 * 把原文带回，让摘要只负责叙述。
 */
const PINNED_KINDS: readonly string[] = [MEMORY_KINDS.routeRecall, MEMORY_KINDS.routeFailed];

/** 回填上限：压缩不能变成「什么都删不掉」。 */
const MAX_PINNED_MESSAGES = 8;

/** 去重键：成功的按终点舞台 id，失败的按原始地名，都没有就退回正文。 */
function pinnedKey(message: ChatMessage): string {
  const routeTo = message.metadata?.routeTo;
  if (typeof routeTo === "string") {
    return `to:${routeTo}`;
  }
  const routeToRef = message.metadata?.routeToRef;
  if (typeof routeToRef === "string") {
    return `ref:${routeToRef}`;
  }
  return `text:${message.content}`;
}

/**
 * 挑出要回填的认知：同一目的地只留最新一条（更早的结论会过期），整体只留最近的若干条。
 *
 * `delete` 后再 `set` 是故意的：Map 因此按「最后一次出现」排序，`slice(-N)` 取到的才是
 * 最近的 N 条，而不是最早出现过的 N 条。
 */
function pinnedMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  for (const message of messages) {
    const kind = message.metadata?.kind;
    if (typeof kind !== "string" || !PINNED_KINDS.includes(kind)) {
      continue;
    }
    const key = pinnedKey(message);
    byKey.delete(key);
    byKey.set(key, message);
  }
  return [...byKey.values()].slice(-MAX_PINNED_MESSAGES);
}

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

  const pinned = pinnedMessages(memory.messages.slice(1));
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
      // 回填的认知保留原 kind（读侧按 kind 过滤），只加一个来源标记。
      ...pinned.map((message) => ({
        type: "human" as const,
        content: message.content,
        metadata: { ...message.metadata, pinned: true },
      })),
    ]);
    await tx
      .update(agentMemories)
      .set({ contextUsageRatio: 0, updatedAt: new Date() })
      .where(eq(agentMemories.id, current.row.id));
  });

  return {
    ...base,
    skipped: false,
    afterMessages: 2 + pinned.length,
    pinnedCount: pinned.length,
    summary,
  };
}

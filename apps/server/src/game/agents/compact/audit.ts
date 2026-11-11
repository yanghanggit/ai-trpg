import { GameError } from "../../errors";
import type { AgentMemoryState, MemoryOwnerRef } from "../../memory";
import { findNameLeaks, type NameAuditInput } from "../../name-audit";

/**
 * 压缩摘要的名字审计：摘要会回灌成长期记忆，所以落账前用名字审计的同一套白名单再查一次。
 *
 * 摘要可以出现观察者自己的名字，或它已经用真名称呼过的其他 actor；出现别的真名说明
 * 压缩 agent 把未认知的名字重新写了回来——拒绝本次压缩，保留旧 memory。
 */

/**
 * actor 的 compact 摘要会回灌成长期记忆，落账前用名字审计的同一套白名单再检查一次：
 * 摘要可以出现观察者自己的名字，或它已经用真名称呼过的其他 actor；其他真名说明
 * 压缩 agent 把未认知的名字重新写了回来，拒绝本次压缩，保留旧 memory。
 */
export function assertActorSummaryKnown(
  input: NameAuditInput,
  owner: MemoryOwnerRef,
  summary: string,
): void {
  const observer = input.actors.find((actor) => actor.id === owner.ownerId);
  if (!observer) {
    throw new GameError("invalid_state", `压缩主体不在 actor 列表中: ${owner.name}`);
  }
  const memory: AgentMemoryState = {
    id: "compact-summary",
    ownerType: "actor",
    ownerId: owner.ownerId,
    name: owner.name,
    contextUsageRatio: 0,
    messages: [
      {
        sequence: 1,
        type: "human",
        content: summary,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const leaks = findNameLeaks({ ...input, memories: [memory] });
  if (leaks.length > 0) {
    throw new GameError(
      "invalid_state",
      `压缩摘要包含观察者未认知的真名，已拒绝写回: ${leaks.length} 处`,
    );
  }
}

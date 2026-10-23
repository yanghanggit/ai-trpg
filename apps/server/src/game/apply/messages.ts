import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { gameMessages, games } from "../../db/schema";
import type {
  Executor,
  PublicMessage,
  ResolvedCommunication,
  ResolvedInteraction,
  ResolvedMovement,
} from "./types";

/** 递增 game 版本；每个成功 intent 都调用一次。 */
export async function bumpGameVersion(
  executor: Executor,
  gameId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(games)
    .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
    .where(eq(games.id, gameId));
}

/** 追加一条公共事件并自动分配 sequence。 */
export async function appendPublicMessage(
  executor: Executor,
  gameId: string,
  actorId: string | null,
  message: PublicMessage,
): Promise<void> {
  const [maxRow] = await executor
    .select({ value: sql<number>`coalesce(max(${gameMessages.sequence}), 0)` })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  const sequence = Number(maxRow?.value ?? 0) + 1;

  await executor.insert(gameMessages).values({
    id: randomUUID(),
    gameId,
    sequence,
    kind: message.kind,
    stageId: message.stageId,
    speakerActorId: actorId,
    targetActorId: message.targetActorId ?? null,
    visibility: message.visibility,
    content: message.content,
  });
}

/** 渲染本次技能选用的物品。 */
export function itemListText(items: readonly { name: string }[]): string {
  return items.length > 0 ? `（使用${items.map((item) => item.name).join("、")}）` : "";
}

export function communicationFeedback(resolved: ResolvedCommunication): string {
  const { intent, stage, targetActor } = resolved;
  const target = targetActor?.name ?? intent.targetActorName ?? "某人";
  switch (intent.mode) {
    case "say":
      return `# 行动结果\n你对${target}说（场景：${stage.name}）：${intent.message}`;
    case "announce":
      return `# 行动结果\n你（场景：${stage.name}）公开说：${intent.message}`;
    case "whisper":
      return `# 行动结果\n你对${target}耳语（场景：${stage.name}）：${intent.message}`;
  }
}

export function movementFeedback(resolved: ResolvedMovement): string {
  switch (resolved.intent.mode) {
    case "wait":
      return "# 行动结果\n你留在原地，继续观察四周。";
    case "move":
      return `# 行动结果\n你抵达了${resolved.targetStage?.name ?? resolved.intent.targetStageName ?? "未知场景"}。`;
  }
}

export function damageFeedback(
  resolved: ResolvedInteraction,
  damage: number,
  remainingHp: number,
): string {
  const target = resolved.target;
  if (!target) {
    throw new Error("damage 目的缺少目标");
  }
  const outcome =
    remainingHp <= 0
      ? `${target.name}倒下了`
      : `${target.name}剩余 HP ${remainingHp}/${target.maxHp}`;
  return `# 行动结果\n你使用攻击${itemListText(resolved.items)}对${target.name}，造成${damage}点伤害；${outcome}。`;
}

export function stealFeedback(targetName: string, itemName: string): string {
  return `# 行动结果\n你从${targetName}身上取走了${itemName}。`;
}

export function giveFeedback(targetName: string, itemName: string): string {
  return `# 行动结果\n你把${itemName}交给了${targetName}。`;
}

export function pickupFeedback(itemName: string): string {
  return `# 行动结果\n你拾取了${itemName}。`;
}

export function useFeedback(targetLabel: string, itemName: string, completed: boolean): string {
  return `# 行动结果\n你对${targetLabel}使用了${itemName}。${
    completed ? "\n封骨之门打开了。" : ""
  }`;
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { actors, games, items, stageItems } from "../../db/schema";
import { GameError } from "../errors";
import { appendItemObservations, appendSkillObservations } from "../observations";
import { SEALED_GATE_KEY_NAME, SEALED_GATE_STAGE_NAME } from "../skills";
import {
  appendPublicMessage,
  bumpGameVersion,
  damageFeedback,
  giveFeedback,
  itemListText,
  pickupFeedback,
  stealFeedback,
  useFeedback,
} from "./messages";
import { assertItemNameFree } from "./queries";
import type { ActorWithStageRow, Executor, ResolvedSkill } from "./types";

async function applyDamage(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSkill,
  now: Date,
): Promise<string> {
  const target = resolved.target;
  if (!target) {
    throw new GameError("invalid_action", "damage 技能缺少目标");
  }
  if (resolved.items.some((item) => item.kind !== "weapon")) {
    throw new GameError("invalid_action", "damage 目的只能使用武器道具");
  }
  const weaponDamage = resolved.items.reduce((total, item) => total + item.damage, 0);
  const damage = Math.max(0, actorRow.actor.attack + weaponDamage - target.defense);
  const remainingHp = Math.max(0, target.hp - damage);
  const death = remainingHp <= 0;

  await executor
    .update(actors)
    .set({ hp: remainingHp, death, updatedAt: now })
    .where(eq(actors.id, target.id));
  await bumpGameVersion(executor, gameId, now);

  const itemText = itemListText(resolved.items);
  const outcome = death
    ? `；${target.name}倒下了。`
    : `；${target.name}剩余 HP ${remainingHp}/${target.maxHp}。`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "attack",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: resolved.skill.broadcast,
    content: `${actorRow.actor.name}对${target.name}使用攻击${itemText}，造成${damage}点伤害${outcome}`,
  });
  await appendSkillObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    { id: target.id, name: target.name, maxHp: target.maxHp },
    resolved.skill,
    resolved.items,
    damage,
    remainingHp,
    death,
  );
  return damageFeedback(resolved, damage, remainingHp);
}

async function applyTransfer(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSkill,
  now: Date,
): Promise<string> {
  const target = resolved.target;
  const transferItem = resolved.transferItem;
  if (!target || !transferItem) {
    throw new GameError("invalid_action", "转移技能缺少目标或物品");
  }
  const purpose = resolved.intent.purpose;
  if (purpose.kind !== "steal" && purpose.kind !== "give") {
    throw new GameError("invalid_action", `不是转移目的: ${purpose.kind}`);
  }

  const receiver = purpose.kind === "steal" ? actorRow.actor : target;
  await assertItemNameFree(executor, receiver.id, transferItem.name);
  await executor.update(items).set({ actorId: receiver.id }).where(eq(items.id, transferItem.id));
  await bumpGameVersion(executor, gameId, now);

  const content =
    purpose.kind === "steal"
      ? `${actorRow.actor.name}从${target.name}身上取走了${transferItem.name}。`
      : `${actorRow.actor.name}把${transferItem.name}交给了${target.name}。`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: resolved.skill.key,
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: resolved.skill.broadcast,
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    purpose.kind,
    transferItem.name,
    { target: { id: target.id, name: target.name }, broadcast: resolved.skill.broadcast },
  );
  return purpose.kind === "steal"
    ? stealFeedback(target.name, transferItem.name)
    : giveFeedback(target.name, transferItem.name);
}

async function applyPickup(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSkill,
  now: Date,
): Promise<string> {
  const stageItem = resolved.stageItem;
  if (!stageItem) {
    throw new GameError("invalid_action", "pickup 技能缺少场景物品");
  }
  await assertItemNameFree(executor, actorRow.actor.id, stageItem.name);
  await executor.delete(stageItems).where(eq(stageItems.id, stageItem.id));
  await executor.insert(items).values({
    id: randomUUID(),
    actorId: actorRow.actor.id,
    name: stageItem.name,
    description: stageItem.description,
    kind: stageItem.kind,
    count: stageItem.count,
    damage: stageItem.damage,
    block: stageItem.block,
  });
  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: resolved.skill.key,
    stageId: resolved.stage.id,
    visibility: resolved.skill.broadcast,
    content: `${actorRow.actor.name}拾取了${stageItem.name}。`,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    "pickup",
    stageItem.name,
    { broadcast: resolved.skill.broadcast },
  );
  return pickupFeedback(stageItem.name);
}

async function completeGame(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  stageId: string,
  itemName: string,
  targetStageName: string,
  now: Date,
): Promise<void> {
  await executor
    .update(games)
    .set({ status: "completed", updatedAt: now })
    .where(eq(games.id, gameId));
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "game_completed",
    stageId,
    visibility: "stage",
    content: `${actorRow.actor.name}用${itemName}打开了${targetStageName}，游戏结束。`,
  });
  console.error(
    `[game] completed: game=${gameId} actor=${actorRow.actor.name} item=${itemName} stage=${targetStageName}`,
  );
}

async function applyUse(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSkill,
  now: Date,
): Promise<string> {
  const target = resolved.target;
  const targetStage = resolved.targetStage;
  const transferItem = resolved.transferItem;
  if ((!target && !targetStage) || !transferItem) {
    throw new GameError("invalid_action", "use 技能缺少目标或物品");
  }
  await bumpGameVersion(executor, gameId, now);

  const targetLabel = targetStage?.name ?? target?.name ?? "目标";
  const content = targetStage
    ? `${actorRow.actor.name}在${targetStage.name}使用了${transferItem.name}。`
    : `${actorRow.actor.name}对${targetLabel}使用了${transferItem.name}。`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: resolved.skill.key,
    stageId: resolved.stage.id,
    ...(target ? { targetActorId: target.id } : {}),
    visibility: resolved.skill.broadcast,
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    "use",
    transferItem.name,
    {
      ...(target ? { target: { id: target.id, name: target.name } } : {}),
      ...(targetStage ? { targetStageName: targetStage.name } : {}),
      broadcast: resolved.skill.broadcast,
    },
  );

  const completed =
    targetStage?.name === SEALED_GATE_STAGE_NAME && transferItem.name === SEALED_GATE_KEY_NAME;
  if (completed && targetStage) {
    await completeGame(
      executor,
      gameId,
      actorRow,
      resolved.stage.id,
      transferItem.name,
      targetStage.name,
      now,
    );
  }
  return useFeedback(targetLabel, transferItem.name, completed);
}

/** 应用技能；按 purpose 分派到各自的结算函数。 */
export async function applySkill(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSkill,
  now: Date,
): Promise<string> {
  switch (resolved.intent.purpose.kind) {
    case "damage":
      return applyDamage(executor, gameId, actorRow, resolved, now);
    case "steal":
    case "give":
      return applyTransfer(executor, gameId, actorRow, resolved, now);
    case "pickup":
      return applyPickup(executor, gameId, actorRow, resolved, now);
    case "use":
      return applyUse(executor, gameId, actorRow, resolved, now);
    case "narrative":
      throw new GameError("invalid_action", "narrative 技能尚未实现");
  }
}

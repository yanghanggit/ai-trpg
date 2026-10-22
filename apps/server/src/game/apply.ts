import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import {
  actors,
  gameMessages,
  games,
  items,
  stageConnections,
  stageItems,
  stages,
  worlds,
} from "../db/schema";
import type { ChatMessage } from "../llm/types";
import { MEMORY_KINDS, type MessageVisibility, visibilityForCommunication } from "./actions";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import {
  appendActionObservations,
  appendCommunicationObservations,
  appendEnvironmentObservations,
  appendItemObservations,
  appendSkillObservations,
} from "./observations";
import { intentClass, intentClassLabel } from "./plan";
import { SEALED_GATE_KEY_NAME, SEALED_GATE_STAGE_NAME } from "./skills";
import { wakeSleepingActors } from "./status";
import type { ActorPlan, CommunicationIntent, MovementIntent, Skill, SkillIntent } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;
type WorldRow = typeof worlds.$inferSelect;
type StageRow = typeof stages.$inferSelect;
type ActorRow = typeof actors.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type StageItemRow = typeof stageItems.$inferSelect;
type ActorWithStageRow = { actor: ActorRow; stage: StageRow };

type PublicMessage = {
  kind: string;
  stageId: string;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
};

type ResolvedCommunication = {
  kind: "communication";
  intent: CommunicationIntent;
  stage: StageRow;
  targetActor?: ActorRow;
};

type ResolvedMovement = {
  kind: "movement";
  intent: MovementIntent;
  stage: StageRow;
  targetStage?: StageRow;
};

type ResolvedSkill = {
  kind: "skill";
  intent: SkillIntent;
  skill: Skill;
  stage: StageRow;
  target?: ActorRow;
  targetStage?: StageRow;
  items: ItemRow[];
  transferItem?: ItemRow;
  stageItem?: StageItemRow;
};

type ResolvedIntent = ResolvedCommunication | ResolvedMovement | ResolvedSkill;

/** 校验 plan 的类别互斥；同类别只能有一个 intent。 */
function validatePlanShape(plan: ActorPlan): void {
  if (plan.intents.length === 0) {
    throw new GameError("invalid_action", "计划中没有行动");
  }
  if (plan.intents.length > 2) {
    throw new GameError("invalid_action", "计划最多包含一个沟通行动和一个行动类行动");
  }
  const classes = new Set<ReturnType<typeof intentClass>>();
  for (const intent of plan.intents) {
    const intentClassValue = intentClass(intent);
    if (classes.has(intentClassValue)) {
      throw new GameError("invalid_action", `本轮已有${intentClassLabel(intentClassValue)}类行动`);
    }
    classes.add(intentClassValue);
  }
}

async function resolveCommunicationTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  intent: CommunicationIntent,
): Promise<ActorRow | undefined> {
  if (intent.message.trim().length === 0) {
    throw new GameError("invalid_action", `${intent.mode} 需要非空 message`);
  }
  if (intent.mode !== "say" && intent.mode !== "whisper") {
    return undefined;
  }
  if (!intent.targetActorName) {
    throw new GameError("invalid_action", `${intent.mode} 需要 targetActorName`);
  }
  const targets = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, intent.targetActorName)))
    .limit(2);
  if (targets.length !== 1) {
    throw new GameError(
      "invalid_action",
      `当前场景内找不到唯一的目标角色: ${intent.targetActorName}`,
    );
  }
  const target = targets[0];
  if (target?.id === actorId) {
    throw new GameError("invalid_action", `不能把 ${intent.mode} 的目标指定为自己`);
  }
  return target;
}

async function resolveMovementTarget(
  executor: Executor,
  world: WorldRow,
  stage: StageRow,
  intent: MovementIntent,
): Promise<StageRow | undefined> {
  if (intent.mode === "wait") {
    return undefined;
  }
  const [target] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, world.id), eq(stages.name, intent.targetStageName ?? "")))
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标 stage 不存在: ${intent.targetStageName ?? ""}`);
  }
  const [connection] = await executor
    .select()
    .from(stageConnections)
    .where(
      and(
        eq(stageConnections.worldId, world.id),
        eq(stageConnections.fromStageId, stage.id),
        eq(stageConnections.toStageId, target.id),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new GameError("invalid_action", `没有从 ${stage.name} 到 ${target.name} 的连接`);
  }
  return target;
}

async function resolveSkillTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  intent: SkillIntent,
): Promise<ActorRow> {
  if (intent.purpose.kind !== "damage") {
    throw new GameError("invalid_action", `暂不支持技能目的: ${intent.purpose.kind}`);
  }
  const targetActorName = intent.purpose.targetActorName.trim();
  if (targetActorName.length === 0) {
    throw new GameError("invalid_action", "damage 目的需要 targetActorName");
  }
  const targets = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, targetActorName)))
    .limit(2);
  const [target] = targets;
  if (targets.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一的技能目标: ${targetActorName}`);
  }
  if (target.id === actorId) {
    throw new GameError("invalid_action", "技能目标不能是自己");
  }
  if (target.death || target.hp <= 0) {
    throw new GameError("invalid_action", `技能目标已经死亡: ${target.name}`);
  }
  return target;
}

async function resolveSkillItems(
  executor: Executor,
  actorId: string,
  itemNames: readonly string[],
): Promise<ItemRow[]> {
  const resolved: ItemRow[] = [];
  for (const itemName of itemNames) {
    const matches = await executor
      .select()
      .from(items)
      .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
      .limit(2);
    const [item] = matches;
    if (matches.length !== 1 || !item) {
      throw new GameError("invalid_action", `actor 没有唯一物品: ${itemName}`);
    }
    resolved.push(item);
  }
  return resolved;
}

async function resolveActorItem(
  executor: Executor,
  actorId: string,
  itemName: string,
): Promise<ItemRow> {
  const matches = await executor
    .select()
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
    .limit(2);
  const [item] = matches;
  if (matches.length !== 1 || !item) {
    throw new GameError("invalid_action", `actor 没有唯一物品: ${itemName}`);
  }
  return item;
}

async function resolveStageItem(
  executor: Executor,
  stageId: string,
  itemName: string,
): Promise<StageItemRow> {
  const matches = await executor
    .select()
    .from(stageItems)
    .where(and(eq(stageItems.stageId, stageId), eq(stageItems.name, itemName)))
    .limit(2);
  const [item] = matches;
  if (matches.length !== 1 || !item) {
    throw new GameError("invalid_action", `场景内没有唯一物品: ${itemName}`);
  }
  return item;
}

async function resolveActorTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  targetActorName: string,
  options: { allowSelf: boolean; allowDead: boolean },
): Promise<ActorRow> {
  const matches = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, targetActorName)))
    .limit(2);
  const [target] = matches;
  if (matches.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一目标: ${targetActorName}`);
  }
  if (!options.allowSelf && target.id === actorId) {
    throw new GameError("invalid_action", "技能目标不能是自己");
  }
  if (!options.allowDead && (target.death || target.hp <= 0)) {
    throw new GameError("invalid_action", `技能目标已经死亡: ${target.name}`);
  }
  return target;
}

async function assertItemNameFree(
  executor: Executor,
  actorId: string,
  itemName: string,
): Promise<void> {
  const [existing] = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
    .limit(1);
  if (existing) {
    throw new GameError("invalid_action", `目标背包已有同名物品: ${itemName}`);
  }
}

async function resolveSkill(
  executor: Executor,
  stage: StageRow,
  actorRow: ActorWithStageRow,
  intent: SkillIntent,
): Promise<ResolvedSkill> {
  const skills = actorRow.actor.skills as unknown as Skill[];
  const skill = skills.find((candidate) => candidate.key === intent.skill.key);
  if (!skill) {
    throw new GameError("invalid_action", `actor 未掌握技能: ${intent.skill.key}`);
  }
  if (skill.resolution !== "computed") {
    throw new GameError("invalid_action", `技能需要 GM 判定: ${skill.name}`);
  }

  const base = {
    kind: "skill" as const,
    intent: { ...intent, skill },
    skill,
    stage,
    items: [] as ItemRow[],
  };

  switch (intent.purpose.kind) {
    case "damage": {
      const resolvedItems = await resolveSkillItems(executor, actorRow.actor.id, intent.itemNames);
      if (skill.itemPolicy === "required" && resolvedItems.length === 0) {
        throw new GameError("invalid_action", `技能需要至少一个道具: ${skill.name}`);
      }
      const target = await resolveSkillTarget(executor, stage.id, actorRow.actor.id, intent);
      return { ...base, items: resolvedItems, target };
    }
    case "steal": {
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent.purpose.targetActorName,
        { allowSelf: false, allowDead: true },
      );
      const transferItem = await resolveActorItem(executor, target.id, intent.purpose.itemName);
      return { ...base, target, transferItem };
    }
    case "give": {
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent.purpose.targetActorName,
        { allowSelf: false, allowDead: false },
      );
      const transferItem = await resolveActorItem(
        executor,
        actorRow.actor.id,
        intent.purpose.itemName,
      );
      return { ...base, target, transferItem };
    }
    case "pickup": {
      const stageItem = await resolveStageItem(executor, stage.id, intent.purpose.itemName);
      return { ...base, stageItem };
    }
    case "use": {
      const transferItem = await resolveActorItem(
        executor,
        actorRow.actor.id,
        intent.purpose.itemName,
      );
      if (intent.purpose.targetStageName !== undefined) {
        if (intent.purpose.targetStageName !== stage.name) {
          throw new GameError("invalid_action", "只能对当前所在场景使用道具");
        }
        return { ...base, targetStage: stage, transferItem };
      }
      const targetActorName = intent.purpose.targetActorName;
      if (!targetActorName) {
        throw new GameError("invalid_action", "use 目的缺少目标");
      }
      const target = await resolveActorTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        targetActorName,
        { allowSelf: true, allowDead: false },
      );
      return { ...base, target, transferItem };
    }
    case "narrative":
      throw new GameError("invalid_action", "narrative 技能尚未实现");
  }
}

/** 顺序校验 intent，并模拟移动后的场景，不写数据库。 */
async function resolvePlan(
  executor: Executor,
  world: WorldRow,
  actorRow: ActorWithStageRow,
  plan: ActorPlan,
): Promise<ResolvedIntent[]> {
  validatePlanShape(plan);
  let stage = actorRow.stage;
  const resolved: ResolvedIntent[] = [];

  for (const intent of plan.intents) {
    if (intent.kind === "communication") {
      const targetActor = await resolveCommunicationTarget(
        executor,
        stage.id,
        actorRow.actor.id,
        intent,
      );
      resolved.push({
        kind: "communication",
        intent,
        stage,
        ...(targetActor ? { targetActor } : {}),
      });
      continue;
    }

    if (intent.kind === "movement") {
      const targetStage = await resolveMovementTarget(executor, world, stage, intent);
      resolved.push({
        kind: "movement",
        intent,
        stage,
        ...(targetStage ? { targetStage } : {}),
      });
      if (targetStage) {
        stage = targetStage;
      }
      continue;
    }

    const resolvedSkill = await resolveSkill(executor, stage, actorRow, intent);
    resolved.push(resolvedSkill);
  }

  return resolved;
}

async function bumpGameVersion(executor: Executor, gameId: string, now: Date): Promise<void> {
  await executor
    .update(games)
    .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
    .where(eq(games.id, gameId));
}

async function appendPublicMessage(
  executor: Executor,
  gameId: string,
  actorId: string,
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

function communicationFeedback(resolved: ResolvedCommunication): string {
  const { intent, stage, targetActor } = resolved;
  if (intent.mode === "say") {
    return `# 行动结果\n你对${targetActor?.name ?? intent.targetActorName ?? "某人"}说（场景：${stage.name}）：${intent.message}`;
  }
  if (intent.mode === "announce") {
    return `# 行动结果\n你（场景：${stage.name}）公开说：${intent.message}`;
  }
  return `# 行动结果\n你对${targetActor?.name ?? intent.targetActorName ?? "某人"}耳语（场景：${stage.name}）：${intent.message}`;
}

function skillFeedback(resolved: ResolvedSkill, damage: number, remainingHp: number): string {
  const target = resolved.target;
  if (!target) {
    throw new Error("damage skill 缺少目标");
  }
  const itemText =
    resolved.items.length > 0
      ? `（使用${resolved.items.map((item) => item.name).join("、")}）`
      : "";
  const outcome =
    remainingHp <= 0
      ? `${target.name}倒下了`
      : `${target.name}剩余 HP ${remainingHp}/${target.maxHp}`;
  return `# 行动结果\n你使用${resolved.intent.skill.name}${itemText}对${target.name}，造成${damage}点伤害；${outcome}。`;
}

function movementFeedback(resolved: ResolvedMovement): string {
  if (resolved.intent.mode === "wait") {
    return "# 行动结果\n你留在原地，继续观察四周。";
  }
  return `# 行动结果\n你抵达了${resolved.targetStage?.name ?? resolved.intent.targetStageName ?? "未知场景"}。`;
}

/** 应用一个已校验 intent，并返回该 intent 的行动结果文本。 */
async function applyResolvedIntent(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedIntent,
  now: Date,
): Promise<string> {
  if (resolved.kind === "communication") {
    await bumpGameVersion(executor, gameId, now);
    const message: PublicMessage = {
      kind: resolved.intent.mode,
      stageId: resolved.stage.id,
      ...(resolved.targetActor ? { targetActorId: resolved.targetActor.id } : {}),
      visibility: visibilityForCommunication(resolved.intent.mode),
      content: resolved.intent.message,
    };
    await appendPublicMessage(executor, gameId, actorRow.actor.id, message);
    await appendCommunicationObservations(
      executor,
      gameId,
      resolved.stage,
      { id: actorRow.actor.id, name: actorRow.actor.name },
      resolved.intent.mode,
      resolved.targetActor,
      resolved.intent.message,
    );
    await wakeSleepingActors(executor, resolved.stage.id, now);
    return communicationFeedback(resolved);
  }

  if (resolved.kind === "skill") {
    const skill = resolved.skill;
    const purpose = resolved.intent.purpose;

    if (purpose.kind === "damage") {
      if (!resolved.target) {
        throw new GameError("invalid_action", "damage 技能缺少目标");
      }
      const damage = Math.max(0, actorRow.actor.attack - resolved.target.defense);
      const remainingHp = Math.max(0, resolved.target.hp - damage);
      const death = remainingHp <= 0;
      await executor
        .update(actors)
        .set({ hp: remainingHp, death, updatedAt: now })
        .where(eq(actors.id, resolved.target.id));
      await bumpGameVersion(executor, gameId, now);
      const itemText =
        resolved.items.length > 0
          ? `（使用${resolved.items.map((item) => item.name).join("、")}）`
          : "";
      const outcome = death
        ? `；${resolved.target.name}倒下了。`
        : `；${resolved.target.name}剩余 HP ${remainingHp}/${resolved.target.maxHp}。`;
      const content = `${actorRow.actor.name}对${resolved.target.name}使用${skill.name}${itemText}，造成${damage}点伤害${outcome}`;
      await appendPublicMessage(executor, gameId, actorRow.actor.id, {
        kind: skill.key,
        stageId: resolved.stage.id,
        targetActorId: resolved.target.id,
        visibility: skill.broadcast,
        content,
      });
      await appendSkillObservations(
        executor,
        gameId,
        resolved.stage,
        { id: actorRow.actor.id, name: actorRow.actor.name },
        { id: resolved.target.id, name: resolved.target.name, maxHp: resolved.target.maxHp },
        skill,
        resolved.items,
        damage,
        remainingHp,
        death,
      );
      await wakeSleepingActors(executor, resolved.stage.id, now);
      return skillFeedback(resolved, damage, remainingHp);
    }

    if (purpose.kind === "steal" || purpose.kind === "give") {
      const target = resolved.target;
      const transferItem = resolved.transferItem;
      if (!target || !transferItem) {
        throw new GameError("invalid_action", `${purpose.kind} 技能缺少目标或物品`);
      }
      if (purpose.kind === "steal") {
        await assertItemNameFree(executor, actorRow.actor.id, transferItem.name);
        await executor
          .update(items)
          .set({ actorId: actorRow.actor.id })
          .where(eq(items.id, transferItem.id));
      } else {
        await assertItemNameFree(executor, target.id, transferItem.name);
        await executor
          .update(items)
          .set({ actorId: target.id })
          .where(eq(items.id, transferItem.id));
      }
      await bumpGameVersion(executor, gameId, now);
      const content =
        purpose.kind === "steal"
          ? `${actorRow.actor.name}从${target.name}身上取走了${transferItem.name}。`
          : `${actorRow.actor.name}把${transferItem.name}交给了${target.name}。`;
      await appendPublicMessage(executor, gameId, actorRow.actor.id, {
        kind: skill.key,
        stageId: resolved.stage.id,
        targetActorId: target.id,
        visibility: skill.broadcast,
        content,
      });
      await appendItemObservations(
        executor,
        gameId,
        resolved.stage,
        { id: actorRow.actor.id, name: actorRow.actor.name },
        purpose.kind,
        transferItem.name,
        { target: { id: target.id, name: target.name }, broadcast: skill.broadcast },
      );
      await wakeSleepingActors(executor, resolved.stage.id, now);
      return purpose.kind === "steal"
        ? `# 行动结果\n你从${target.name}身上取走了${transferItem.name}。`
        : `# 行动结果\n你把${transferItem.name}交给了${target.name}。`;
    }

    if (purpose.kind === "pickup") {
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
      });
      await bumpGameVersion(executor, gameId, now);
      const content = `${actorRow.actor.name}拾取了${stageItem.name}。`;
      await appendPublicMessage(executor, gameId, actorRow.actor.id, {
        kind: skill.key,
        stageId: resolved.stage.id,
        visibility: skill.broadcast,
        content,
      });
      await appendItemObservations(
        executor,
        gameId,
        resolved.stage,
        { id: actorRow.actor.id, name: actorRow.actor.name },
        "pickup",
        stageItem.name,
        { broadcast: skill.broadcast },
      );
      await wakeSleepingActors(executor, resolved.stage.id, now);
      return `# 行动结果\n你拾取了${stageItem.name}。`;
    }

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
      kind: skill.key,
      stageId: resolved.stage.id,
      ...(target ? { targetActorId: target.id } : {}),
      visibility: skill.broadcast,
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
        broadcast: skill.broadcast,
      },
    );
    await wakeSleepingActors(executor, resolved.stage.id, now);

    const completed =
      targetStage?.name === SEALED_GATE_STAGE_NAME && transferItem.name === SEALED_GATE_KEY_NAME;
    if (completed) {
      await executor
        .update(games)
        .set({ status: "completed", updatedAt: now })
        .where(eq(games.id, gameId));
      await appendPublicMessage(executor, gameId, actorRow.actor.id, {
        kind: "game_completed",
        stageId: resolved.stage.id,
        visibility: "stage",
        content: `${actorRow.actor.name}用${transferItem.name}打开了${targetStage?.name ?? "目标场景"}，游戏结束。`,
      });
      console.error(
        `[game] completed: game=${gameId} actor=${actorRow.actor.name} item=${transferItem.name} stage=${targetStage?.name ?? ""}`,
      );
    }

    return `# 行动结果\n你对${targetLabel}使用了${transferItem.name}。${
      completed ? "\n封骨之门打开了。" : ""
    }`;
  }

  if (resolved.intent.mode === "move" && resolved.targetStage) {
    await executor
      .update(actors)
      .set({ stageId: resolved.targetStage.id, updatedAt: now })
      .where(eq(actors.id, actorRow.actor.id));
    await bumpGameVersion(executor, gameId, now);
    await appendPublicMessage(executor, gameId, actorRow.actor.id, {
      kind: "move",
      stageId: resolved.targetStage.id,
      visibility: "stage",
      content: `${actorRow.actor.name}从${resolved.stage.name}走向${resolved.targetStage.name}。`,
    });
    await appendEnvironmentObservations(
      executor,
      gameId,
      resolved.targetStage.id,
      actorRow.actor.id,
      `# 环境变化\n${actorRow.actor.name}从${resolved.stage.name}进入了${resolved.targetStage.name}。`,
    );
    await wakeSleepingActors(executor, resolved.stage.id, now);
    await wakeSleepingActors(executor, resolved.targetStage.id, now);
    return movementFeedback(resolved);
  }

  await bumpGameVersion(executor, gameId, now);
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: "wait",
    stageId: resolved.stage.id,
    visibility: "stage",
    content: `${actorRow.actor.name}留在原地，继续观察四周。`,
  });
  await appendActionObservations(
    executor,
    gameId,
    resolved.stage.id,
    actorRow.actor.id,
    `# 场景动态\n${actorRow.actor.name}留在原地，继续观察四周。`,
  );
  return movementFeedback(resolved);
}

/**
 * 校验并应用一次 actor 计划。
 *
 * 计划中的 intent 按调用顺序执行；非法计划写入拒绝记忆并返回 false。
 * 数据库等意外错误继续抛出，让事务回滚。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  newMessages: readonly ChatMessage[],
  loopSuccess: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能继续行动: ${game.status}`);
    }
    const [world] = await tx.select().from(worlds).where(eq(worlds.gameId, gameId)).limit(1);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const [actorRow] = await tx
      .select({ actor: actors, stage: stages })
      .from(actors)
      .innerJoin(stages, eq(actors.stageId, stages.id))
      .where(and(eq(actors.id, actorId), eq(stages.worldId, world.id)))
      .limit(1);
    if (!actorRow) {
      throw new GameError("not_found", `actor 不存在: ${actorId}`);
    }
    if (actorRow.actor.death) {
      throw new GameError("invalid_action", `actor 已死亡: ${actorRow.actor.name}`);
    }
    const memory = await loadAgentMemory(tx, gameId, actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    if (!plan || plan.intents.length === 0) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 行动结果\n本轮没有提交有效行动计划，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return false;
    }

    let resolved: ResolvedIntent[];
    try {
      resolved = await resolvePlan(tx, world, actorRow, plan);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${error.message}`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return false;
    }

    if (newMessages.length > 0) {
      await appendMemoryMessages(tx, memory.row.id, [...newMessages]);
    }

    const now = new Date();
    for (const resolvedIntent of resolved) {
      const feedback = await applyResolvedIntent(tx, gameId, actorRow, resolvedIntent, now);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: feedback,
          metadata: { kind: MEMORY_KINDS.actionFeedback },
        },
      ]);
    }

    return true;
  });
}

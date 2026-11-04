import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import {
  actors,
  gamePlayers,
  games,
  items,
  stageConnections,
  stageItems,
  stages,
  users,
  worlds,
} from "../db/schema";
import { dumpSystemPrompts } from "../debug/prompt-dump";
import type { Logger } from "../logging";
import { buildAffixSystemPrompt } from "./affixes";
import type { Executor } from "./apply/types";
import { toStats } from "./attributes";
import { buildCompactSystemPrompt } from "./compact";
import type { Actor, CreateGameInput, ItemDefinition, Stage, World } from "./content";
import { buildDialogueAuditSystemPrompt } from "./dialogue-audit";
import { buildDropSystemPrompt } from "./drops";
import { assertEdgeShape } from "./edges";
import { GameError } from "./errors";
import { resolveAppearance } from "./form";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
  createActorMemory,
  createStageMemory,
  createWorldMemory,
} from "./memory";
import { recordAppearance } from "./persistence/appearances";
import { allocateEntitySeq } from "./persistence/entity-seq";
import { recordKnownStage } from "./persistence/known-stages";
import { upsertSignatureName } from "./persistence/signature-names";
import { insertSignature } from "./persistence/signatures";
import { recordStageVisit } from "./persistence/visits";
import { getGameState } from "./read/game-state";
import { buildStorySystemPrompt } from "./story";
import type { GameState } from "./types";
import { parseWorldContent } from "./world-content";

type PromptDump = { name: string; prompt: string };
type ActorRef = { actorId: string; signatureId: string; name: string };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** 显式 slug 只做规范化，隐式 slug 追加 gameId 前缀避免跨局重名。 */
function resolveSlug(input: CreateGameInput, gameId: string, gameName: string): string {
  const requested = input.slug?.trim();
  const base = slugify(requested ?? gameName);
  if (requested !== undefined && base.length === 0) {
    throw new GameError("invalid_action", `slug 不能为空或只包含非 ASCII 字符: ${requested}`);
  }
  return requested ? base : `${base || "game"}-${gameId.slice(0, 8)}`;
}

/** 物品行的公共列；`stage_items` 与 `items` 字段相同，只差归属列。 */
function itemValues(item: ItemDefinition, seq: number) {
  return {
    id: randomUUID(),
    seq,
    key: item.key,
    name: item.name,
    description: item.description,
    kind: item.kind,
    source: item.source ?? null,
    count: item.count ?? 1,
    stats: toStats(item.stats),
    effect: item.effect,
    affixes: [...(item.affixes ?? [])],
    actions: [...(item.actions ?? [])],
  };
}

/** 物品 key 必须全局唯一；行为与内容判定都按 key 引用物品。 */
function assertUniqueItemKeys(world: World): void {
  const seen = new Set<string>();
  const all = [
    ...world.stages.flatMap((stage) => stage.items ?? []),
    ...world.actors.flatMap((actor) => actor.items),
  ];
  for (const item of all) {
    if (item.key.trim().length === 0) {
      throw new GameError("invalid_state", "物品 key 不能为空");
    }
    if (seen.has(item.key)) {
      throw new GameError("invalid_state", `重复的物品 key: ${item.key}`);
    }
    seen.add(item.key);
  }
}

/** actor key 是内容层引用角色的唯一方式，必须全局唯一。 */
function assertUniqueActorKeys(world: World): void {
  const seen = new Set<string>();
  for (const actor of world.actors) {
    if (seen.has(actor.key)) {
      throw new GameError("invalid_state", `重复的 actor key: ${actor.key}`);
    }
    seen.add(actor.key);
  }
}

/** 物化场景与场景物品；stage key 在建局内必须唯一。 */
async function createStages(
  tx: Executor,
  input: { gameId: string; worldId: string; world: World },
): Promise<{ stageIds: Map<string, string>; prompts: PromptDump[] }> {
  const stageIds = new Map<string, string>();
  const prompts: PromptDump[] = [];
  const { gameId, worldId, world } = input;

  for (const [ordinal, stage] of world.stages.entries()) {
    if (stageIds.has(stage.key)) {
      throw new GameError("invalid_state", `重复的 stage key: ${stage.key}`);
    }
    const stageId = randomUUID();
    stageIds.set(stage.key, stageId);
    await insertStage(tx, gameId, worldId, stage, stageId, ordinal);
    const prompt = buildStageSystemPrompt(
      {
        name: world.worldName,
        campaignSetting: world.campaignSetting,
        globalRules: world.globalRules,
      },
      stage,
    );
    prompts.push({ name: stage.name, prompt });
    await createStageMemory(
      tx,
      gameId,
      { id: stageId, name: stage.name, profile: stage.profile },
      prompt,
    );
    for (const item of stage.items ?? []) {
      await tx
        .insert(stageItems)
        .values({ ...itemValues(item, await allocateEntitySeq(tx, gameId)), stageId });
    }
  }
  return { stageIds, prompts };
}

async function insertStage(
  tx: Executor,
  gameId: string,
  worldId: string,
  stage: Stage,
  stageId: string,
  ordinal: number,
): Promise<void> {
  await tx.insert(stages).values({
    id: stageId,
    seq: await allocateEntitySeq(tx, gameId),
    worldId,
    key: stage.key,
    name: stage.name,
    profile: stage.profile,
    environment: stage.environment,
    anchors: stage.anchors ? [...stage.anchors] : [],
    actions: [...stage.actions],
    teleportBlocked: stage.teleportBlocked ?? false,
    ordinal,
  });
}

/** 物化场景图；两端都必须是本 world 里已声明的 stage。 */
async function createConnections(
  tx: Executor,
  input: { worldId: string; world: World; stageIds: Map<string, string> },
): Promise<void> {
  for (const connection of input.world.connections) {
    const fromStageId = input.stageIds.get(connection.from);
    const toStageId = input.stageIds.get(connection.to);
    if (!fromStageId || !toStageId) {
      throw new GameError(
        "invalid_state",
        `连接引用了不存在的 stage: ${connection.from} -> ${connection.to}`,
      );
    }
    assertEdgeShape(fromStageId, toStageId);
    await tx.insert(stageConnections).values({
      id: randomUUID(),
      worldId: input.worldId,
      fromStageId,
      toStageId,
      passage: connection.passage ?? "open",
    });
  }
}

/** 物化 actor、开局签名、外观、随身物品、记忆与起始到访。 */
async function createActors(
  tx: Executor,
  input: {
    gameId: string;
    worldId: string;
    world: World;
    stageIds: Map<string, string>;
    now: Date;
  },
): Promise<{ actorRefs: Map<string, ActorRef>; prompts: PromptDump[] }> {
  const actorRefs = new Map<string, ActorRef>();
  const prompts: PromptDump[] = [];
  const { gameId, worldId, world, stageIds, now } = input;

  for (const actor of world.actors) {
    const actorStageId = stageIds.get(actor.stageKey);
    if (!actorStageId) {
      throw new GameError("invalid_state", `actor 引用了不存在的 stage: ${actor.stageKey}`);
    }
    const actorId = await insertActor(tx, gameId, actor, actorStageId);

    // 开局只有一个签名。伪装 / 变身之后才会插入新签名。
    const signatureId = randomUUID();
    await insertSignature(tx, {
      id: signatureId,
      seq: await allocateEntitySeq(tx, gameId),
      actorId,
      form: actor.signature.form,
    });
    await recordAppearance(tx, {
      gameId,
      actorId,
      text: resolveAppearance(actor.signature),
      input: {
        version: 1,
        source: "seed",
        contentKey: world.contentKey,
        contentVersion: world.contentVersion,
        actorKey: actor.key,
        form: actor.signature.form,
        fallback: !actor.signature.appearance?.trim(),
      },
      now,
    });
    actorRefs.set(actor.key, { actorId, signatureId, name: actor.name });

    for (const item of actor.items) {
      await tx
        .insert(items)
        .values({ ...itemValues(item, await allocateEntitySeq(tx, gameId)), actorId });
    }

    const prompt = buildActorSystemPrompt(
      {
        id: worldId,
        name: world.worldName,
        campaignSetting: world.campaignSetting,
        globalRules: world.globalRules,
      },
      { name: actor.name, profile: actor.profile, form: actor.signature.form },
    );
    prompts.push({ name: actor.name, prompt });
    await createActorMemory(
      tx,
      gameId,
      {
        id: actorId,
        name: actor.name,
        profile: actor.profile,
        openingBriefing: actor.openingBriefing,
        form: actor.signature.form,
      },
      prompt,
    );
    // 开局即在起始场景：起点算一次到访，起点名字从一开始就是 actor 的知识。
    await recordStageVisit(tx, gameId, actorId, actorStageId, now);
  }
  return { actorRefs, prompts };
}

async function insertActor(
  tx: Executor,
  gameId: string,
  actor: Actor,
  stageId: string,
): Promise<string> {
  const actorId = randomUUID();
  const stats = toStats(actor.stats);
  await tx.insert(actors).values({
    id: actorId,
    seq: await allocateEntitySeq(tx, gameId),
    stageId,
    key: actor.key,
    name: actor.name,
    profile: actor.profile,
    stats,
    // 内容只声明 hp：hp 为 0 就是尸体，没有单独的死亡状态可写。
    hp: actor.hp ?? stats.maxHp,
    isDefaultPlayer: actor.isDefaultPlayer ?? false,
    equipment: actor.equipment ?? {},
    actions: [...actor.actions],
  });
  return actorId;
}

/** 开局名字绑定：观察者与对象都用内容 key 引用，落库时变成 actor / 签名 id。 */
async function bindSignatureNames(
  tx: Executor,
  input: { gameId: string; world: World; actorRefs: Map<string, ActorRef> },
): Promise<void> {
  for (const binding of input.world.signatureNames ?? []) {
    const observer = input.actorRefs.get(binding.observer);
    const subject = input.actorRefs.get(binding.subject);
    if (!observer) {
      throw new GameError(
        "invalid_state",
        `signatureNames 引用了不存在的观察者: ${binding.observer}`,
      );
    }
    if (!subject) {
      throw new GameError("invalid_state", `signatureNames 引用了不存在的对象: ${binding.subject}`);
    }
    if (observer.actorId === subject.actorId) {
      throw new GameError(
        "invalid_state",
        `signatureNames 不能把自己记作他人: ${binding.observer}`,
      );
    }
    await upsertSignatureName(
      tx,
      {
        gameId: input.gameId,
        observerActorId: observer.actorId,
        signatureId: subject.signatureId,
        name: binding.name,
        source: "content",
        learnedStageId: null,
      },
      new Date(),
    );
  }
}

/**
 * 开局「听说过某些场景」：内容用 key 引用，落库时变成 actor / stage id。
 *
 * 与 `signatureNames` 同一套路；重复声明只保留第一次，不报错。
 */
async function bindKnownStages(
  tx: Executor,
  input: {
    gameId: string;
    world: World;
    stageIds: Map<string, string>;
    actorRefs: Map<string, ActorRef>;
    now: Date;
  },
): Promise<void> {
  for (const entry of input.world.knownStages ?? []) {
    const actorRef = input.actorRefs.get(entry.actor);
    const stageId = input.stageIds.get(entry.stage);
    if (!actorRef) {
      throw new GameError("invalid_state", `knownStages 引用了不存在的 actor: ${entry.actor}`);
    }
    if (!stageId) {
      throw new GameError("invalid_state", `knownStages 引用了不存在的场景: ${entry.stage}`);
    }
    await recordKnownStage(
      tx,
      {
        gameId: input.gameId,
        actorId: actorRef.actorId,
        stageId,
        source: "content",
        learnedStageId: null,
      },
      input.now,
    );
  }
}

/** 世界职能系统的真实入口：与运行时同一份拼装，导出才不会是另写的副本。 */
function buildFunctionPrompts(world: World): PromptDump[] {
  const constitution = { name: world.worldName, ...world };
  return [
    { name: "drops", prompt: buildDropSystemPrompt(constitution) },
    { name: "affixes", prompt: buildAffixSystemPrompt(constitution) },
    { name: "story", prompt: buildStorySystemPrompt(constitution) },
    { name: "compact", prompt: buildCompactSystemPrompt(constitution) },
    { name: "dialogue-audit", prompt: buildDialogueAuditSystemPrompt(constitution) },
  ];
}

/** 创建一局游戏及初始 world、stage、actor、item 与 memory。 */
export async function createGame(
  db: Database,
  input: CreateGameInput,
  options: { logger?: Logger } = {},
): Promise<GameState> {
  const world = parseWorldContent(input.world);
  const gameId = randomUUID();
  const gameName = input.name?.trim() || world.worldName;
  const slug = resolveSlug(input, gameId, gameName);
  const worldPrompt = buildWorldSystemPrompt(world);

  // 建局时收集最终 system prompt，事务提交后导出为人类可读的 md。
  const stagePrompts: PromptDump[] = [];
  const actorPrompts: PromptDump[] = [];

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, input.username)).limit(1);
    if (!user) {
      throw new GameError("not_found", `用户不存在: ${input.username}`);
    }
    const playerId = randomUUID();
    const worldId = randomUUID();

    await tx.insert(games).values({
      id: gameId,
      ownerId: user.id,
      slug,
      name: gameName,
      status: "active",
      contentVersion: world.contentVersion,
      version: 0,
    });
    await tx.insert(gamePlayers).values({ id: playerId, gameId, userId: user.id, role: "player" });
    await tx.insert(worlds).values({
      id: worldId,
      seq: await allocateEntitySeq(tx, gameId),
      gameId,
      name: world.worldName,
      contentKey: world.contentKey,
      profile: world.profile,
      campaignSetting: world.campaignSetting,
      globalRules: world.globalRules,
      worldFunctions: world.worldFunctions,
      actions: [...world.actions],
    });
    await createWorldMemory(
      tx,
      gameId,
      {
        id: worldId,
        worldName: world.worldName,
        campaignSetting: world.campaignSetting,
        globalRules: world.globalRules,
      },
      worldPrompt,
    );

    const stages = await createStages(tx, { gameId, worldId, world });
    stagePrompts.push(...stages.prompts);
    assertUniqueItemKeys(world);
    assertUniqueActorKeys(world);
    await createConnections(tx, { worldId, world, stageIds: stages.stageIds });

    // 建局是一次写入：外观与起始到访共享同一个时间戳，免得同一批数据出现先后差异。
    const actors = await createActors(tx, {
      gameId,
      worldId,
      world,
      stageIds: stages.stageIds,
      now: new Date(),
    });
    actorPrompts.push(...actors.prompts);
    await bindSignatureNames(tx, { gameId, world, actorRefs: actors.actorRefs });
    await bindKnownStages(tx, {
      gameId,
      world,
      stageIds: stages.stageIds,
      actorRefs: actors.actorRefs,
      now: new Date(),
    });
  });

  await dumpSystemPrompts({
    world: { name: world.worldName, contentVersion: world.contentVersion },
    worldPrompt,
    functionPrompts: buildFunctionPrompts(world),
    stagePrompts,
    actorPrompts,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return getGameState(db, gameId);
}

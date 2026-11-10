import { randomUUID } from "node:crypto";
import { actors, items } from "../../db/schema";
import { resolveAppearance } from "../appearance/form";
import { toStats } from "../attributes";
import { GameError } from "../errors";
import { buildActorSystemPrompt, createActorMemory } from "../memory";
import { recordAppearance } from "../persistence/appearances";
import { allocateEntitySeq } from "../persistence/entity-seq";
import type { Executor } from "../persistence/rows";
import { upsertSignatureName } from "../persistence/signature-names";
import { insertSignature } from "../persistence/signatures";
import { recordStageVisit } from "../persistence/visits";
import { type Actor, actorInnateActions, type World } from "../world-definition";
import { itemValues } from "./rows";
import type { ActorRef, PromptDump } from "./types";

/**
 * 物化 actor：角色行、开局签名、外观快照、随身物品、记忆与起始到访。
 *
 * 开局只有一个签名（伪装 / 变身后才会插入新的）；外观与起始到访共享同一个时间戳，
 * 免得同一批数据出现先后差异。
 */

/** 物化 actor、开局签名、外观、随身物品、记忆与起始到访。 */
export async function createActors(
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

    for (const item of actor.inventory) {
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

export async function insertActor(
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
    actions: actorInnateActions(actor),
  });
  return actorId;
}

/** 开局名字绑定：观察者与对象都用内容 key 引用，落库时变成 actor / 签名 id。 */
/**
 * 开局前就去过的场景：写一条到访，和真实走到那里一模一样。
 *
 * 它只影响记忆（认得出这道门、名字可用），不参与 move 权限；`sealed` 边该过不去还是过不去。
 */
export async function bindVisitedStages(
  tx: Executor,
  input: {
    gameId: string;
    world: World;
    stageIds: Map<string, string>;
    actorRefs: Map<string, ActorRef>;
    now: Date;
  },
): Promise<void> {
  for (const entry of input.world.visitedStages ?? []) {
    const actorRef = input.actorRefs.get(entry.actor);
    const stageId = input.stageIds.get(entry.stage);
    if (!actorRef) {
      throw new GameError("invalid_state", `visitedStages 引用了不存在的 actor: ${entry.actor}`);
    }
    if (!stageId) {
      throw new GameError("invalid_state", `visitedStages 引用了不存在的场景: ${entry.stage}`);
    }
    await recordStageVisit(tx, input.gameId, actorRef.actorId, stageId, input.now);
  }
}

export async function bindSignatureNames(
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

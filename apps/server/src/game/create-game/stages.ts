import { randomUUID } from "node:crypto";
import { stageConnections, stageItems, stages } from "../../db/schema";
import type { Executor } from "../apply/types";
import { GameError } from "../errors";
import { buildStageSystemPrompt, createStageMemory } from "../memory";
import { allocateEntitySeq } from "../persistence/entity-seq";
import { assertEdgeShape } from "../stage-state";
import type { Stage, World } from "../world-definition";
import { itemValues } from "./rows";
import type { PromptDump } from "./types";

/**
 * 物化场景：场景行、场景物品、场景记忆与场景图。
 *
 * 顺序是强制的：先有 stage id 才能挂物品与记忆；连接必须等两端都建好，
 * 否则只能在写了一半的图上做引用校验。
 */

/** 物化场景与场景物品；stage key 在建局内必须唯一。 */
export async function createStages(
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
    for (const anchor of stage.anchors ?? []) {
      for (const item of anchor.items ?? []) {
        await tx.insert(stageItems).values({
          ...itemValues(item, await allocateEntitySeq(tx, gameId)),
          stageId,
          anchorKey: anchor.key,
        });
      }
    }
  }
  return { stageIds, prompts };
}

export async function insertStage(
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
    // 锚点行只存身份与文本；物品在 stage_items，靠 anchor_key 挂回去。
    anchors: (stage.anchors ?? []).map((anchor) => ({
      key: anchor.key,
      label: anchor.label,
      ...(anchor.description === undefined ? {} : { description: anchor.description }),
    })),
    actions: [...stage.actions],
    teleportBlocked: stage.teleportBlocked ?? false,
    ordinal,
  });
}

/** 物化场景图；两端都必须是本 world 里已声明的 stage。 */
export async function createConnections(
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

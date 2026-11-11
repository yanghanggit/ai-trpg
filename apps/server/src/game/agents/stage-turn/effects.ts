import { type TraceContext, traceEvent } from "../../../debug/trace";
import { GameError } from "../../errors";
import type { StageEventMetadata } from "../../kernel/observation-text";
import type { StageAction } from "../../kernel/types";
import { appendWorldNotification } from "../../memory/world-channel";
import { appendStageMemory } from "../../observations";
import { openPassage } from "../../persistence/edges";
import { appendPublicMessage } from "../../persistence/game-messages";
import { deleteStageItemsByAnchor } from "../../persistence/items";
import type { Executor, StageRow, WorldRow } from "../../persistence/rows";
import { setStageAnchors, setStageEnvironment } from "../../persistence/stages";
import {
  type AnchorWrite,
  describeStoredAnchors,
  isAnchorWrite,
  type StoredAnchor,
} from "./anchors";

/**
 * 一次舞台级事件的三个落点：公共事件、舞台记忆、轨迹。
 *
 * 仲裁的每个分支都要落这三样，顺序也固定；抽成一处，免得某个分支漏掉记忆或轨迹。
 */
async function recordStageEvent(
  tx: Executor,
  input: {
    gameId: string;
    stageId: string;
    content: string;
    meta: StageEventMetadata;
    actionKind: StageAction["kind"];
    trace: TraceContext | undefined;
  },
): Promise<void> {
  await appendPublicMessage(tx, input.gameId, null, {
    kind: input.meta.eventKind,
    stageId: input.stageId,
    visibility: "stage",
    content: input.content,
  });
  await appendStageMemory(
    tx,
    input.gameId,
    input.stageId,
    `# 舞台事件\n${input.content}`,
    input.meta,
    input.trace,
  );
  await traceEvent(input.trace, {
    event: "applied",
    actionKind: input.actionKind,
    feedback: input.content,
  });
}

/** 落账一条仲裁动作；上游已经校验过能力、上限与目标存在性。 */
export async function applyStageAction(
  tx: Executor,
  input: {
    gameId: string;
    world: WorldRow;
    stage: StageRow;
    stageByName: ReadonlyMap<string, StageRow>;
    anchorChange: {
      action: AnchorWrite;
      anchors: StoredAnchor[];
      summary: string;
      removedAnchorKey?: string;
    } | null;
    action: StageAction;
    trace: TraceContext | undefined;
  },
): Promise<void> {
  const { gameId, world, stage, stageByName, anchorChange, action, trace } = input;

  if (action.kind === "submit_environment") {
    if (action.environment !== stage.environment) {
      await setStageEnvironment(tx, stage.id, action.environment);
      await recordStageEvent(tx, {
        gameId,
        stageId: stage.id,
        content: `${stage.name}的环境发生了变化。\n${action.environment}`,
        meta: { eventKind: "environment_change" },
        actionKind: action.kind,
        trace,
      });
    }
    return;
  }

  if (action.kind === "open_passage") {
    const target = stageByName.get(action.targetStageName);
    if (!target) {
      throw new GameError("invalid_state", `通道目标舞台不存在: ${action.targetStageName}`);
    }
    const opened = await openPassage(tx, world.id, stage.id, target.id);
    if (!opened) {
      throw new GameError("invalid_state", `没有通往 ${target.name} 的未开启通道: ${stage.name}`);
    }
    await recordStageEvent(tx, {
      gameId,
      stageId: stage.id,
      content: `${stage.name}通往${target.name}的通道开启了。`,
      meta: { eventKind: "passage_change", targetStageId: target.id },
      actionKind: action.kind,
      trace,
    });
    return;
  }

  if (isAnchorWrite(action)) {
    if (!anchorChange || anchorChange.action !== action) {
      throw new GameError("invalid_state", "锚点变更没有通过校验");
    }
    if (anchorChange.removedAnchorKey !== undefined) {
      await deleteStageItemsByAnchor(tx, stage.id, anchorChange.removedAnchorKey);
    }
    await setStageAnchors(tx, stage.id, anchorChange.anchors);
    await recordStageEvent(tx, {
      gameId,
      stageId: stage.id,
      content: `${stage.name}的可交互点发生了变化。\n${anchorChange.summary}\n${describeStoredAnchors(anchorChange.anchors)}`,
      meta: { eventKind: "anchor_change" },
      actionKind: action.kind,
      trace,
    });
    return;
  }

  await appendWorldNotification(tx, gameId, world.id, stage, action.notification, trace);
  await appendStageMemory(
    tx,
    gameId,
    stage.id,
    `# 舞台事件\n${stage.name}向世界发出通知：${action.notification}`,
    { eventKind: "world_notification" },
    trace,
  );
  await traceEvent(trace, {
    event: "applied",
    actionKind: action.kind,
    feedback: action.notification,
  });
}

import type { Database } from "../../db/pool";
import { type TraceContext, traceEvent } from "../../debug/trace";
import { bumpGameVersion } from "../apply/messages";
import { listActorNamesInWorld } from "../apply/queries";

import {
  MAX_STAGE_ANCHOR_WRITES_PER_TURN,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MEMORY_KINDS,
} from "../constants";
import { GameError } from "../errors";
import { appendMemoryMessages, ensureStageOpeningSnapshot, loadAgentMemory } from "../memory";
import { isPassageSealed, listOpenNeighborStageNames } from "../persistence/edges";
import { lockGameRow } from "../persistence/games";
import { listStageItems } from "../persistence/items";
import { listStagesOfWorld, loadStageInWorld } from "../persistence/stages";
import { loadWorldByGame } from "../persistence/worlds";
import { assertStageFacingText } from "../text-guard";
import type { StagePlan } from "../types";
import { type AnchorWrite, computeAnchorChange, isAnchorWrite, type StoredAnchor } from "./anchors";
import { applyStageAction } from "./effects";

/**
 * environment / 锚点文本的写入守卫：角色名、编号，以及「还没打通的场景名」。
 *
 * 演员能看见的只有从本场景走得到的地方；未开启通道对面叫什么，要靠发现和对话浮出来，
 * 不能由一句环境描写替你宣布。允许点名的集合在写入时现查，跟着通道开合一起变。
 */
function stageFacingGuard(input: {
  actorNames: readonly string[];
  stageNames: readonly string[];
  visibleStageNames: ReadonlySet<string>;
}) {
  return (text: string, label: string): void => assertStageFacingText(text, { ...input, label });
}

/** 计划非法时写入 stage memory 并返回 false；数据库错误继续抛出。 */
export async function applyStagePlan(
  db: Database,
  gameId: string,
  stageId: string,
  plan: StagePlan | null,
  loopSuccess: boolean,
  trace?: TraceContext,
): Promise<boolean> {
  await traceEvent(trace, { event: "plan", actions: plan?.actions ?? [] });
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能继续行动: ${game.status}`);
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const stage = await loadStageInWorld(tx, stageId, world.id);
    if (!stage) {
      throw new GameError("not_found", `stage 不存在: ${stageId}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "stage", stage.id);
    if (!memory) {
      throw new GameError("invalid_state", `stage 缺少 memory: ${stage.id}`);
    }
    // 先补基线，再写本轮结论与事件。
    if (await ensureStageOpeningSnapshot(tx, memory, stage)) {
      await traceEvent(trace, {
        event: "observed",
        via: "stage-memory",
        kind: MEMORY_KINDS.stageOpeningSnapshot,
        stageId: stage.id,
      });
    }
    const actorNames = (await listActorNamesInWorld(tx, world.id)).map((actor) => actor.name);
    const stagesOfWorld = await listStagesOfWorld(tx, world.id);
    const stageActions = stage.actions;

    const reject = async (content: string, kind: string): Promise<false> => {
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 仲裁结果\n${content}`,
          metadata: { kind, loopSuccess },
        },
      ]);
      await traceEvent(trace, { event: "rejected", code: kind, reason: content });
      return false;
    };

    if (!plan) {
      return reject("本轮没有提交有效计划，状态未改变。", MEMORY_KINDS.planFailed);
    }

    const environments = plan.actions.flatMap((action) =>
      action.kind === "submit_environment" ? [action.environment] : [],
    );
    const notifications = plan.actions.flatMap((action) =>
      action.kind === "notify_world" ? [action.notification] : [],
    );
    const passages = plan.actions.flatMap((action) =>
      action.kind === "open_passage" ? [action.targetStageName] : [],
    );
    const anchorWrites = plan.actions.filter(isAnchorWrite);
    // 允许点名的场景：本场景自己的名字，加上开着的出入边对面，以及本轮就要打开的那条。
    // 边表只有本 world 的十几行，跟着回合查一次比按需缓存更好读。
    const guardStageFacing = stageFacingGuard({
      actorNames,
      stageNames: stagesOfWorld.map((candidate) => candidate.name),
      visibleStageNames: new Set([
        stage.name,
        ...(await listOpenNeighborStageNames(tx, world.id, stage.id)),
        ...passages,
      ]),
    });
    if (environments.length > 1) {
      return reject("本轮最多一次 environment 更新。", MEMORY_KINDS.actionRejected);
    }
    if (passages.length > 1) {
      return reject("本轮最多打开一条通道。", MEMORY_KINDS.actionRejected);
    }
    if (notifications.length > MAX_STAGE_NOTIFICATIONS_PER_TURN) {
      throw new GameError(
        "invalid_state",
        `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
      );
    }
    if (notifications.length > 0 && !stageActions.includes("notify_world")) {
      return reject("通知被拒绝：本场景没有 notify_world 能力。", MEMORY_KINDS.actionRejected);
    }
    if (passages.length > 0 && !stageActions.includes("open_passage")) {
      return reject("通道变更被拒绝：本场景没有 open_passage 能力。", MEMORY_KINDS.actionRejected);
    }
    if (anchorWrites.length > MAX_STAGE_ANCHOR_WRITES_PER_TURN) {
      return reject(
        `本轮最多调整 ${MAX_STAGE_ANCHOR_WRITES_PER_TURN} 个锚点。`,
        MEMORY_KINDS.actionRejected,
      );
    }
    for (const action of anchorWrites) {
      if (!stageActions.includes(action.kind)) {
        return reject(
          `锚点变更被拒绝：本场景没有 ${action.kind} 能力。`,
          MEMORY_KINDS.actionRejected,
        );
      }
    }
    let anchorChange: {
      action: AnchorWrite;
      anchors: StoredAnchor[];
      summary: string;
      removedAnchorKey?: string;
    } | null = null;
    if (anchorWrites.length > 0 && anchorWrites[0]) {
      const stored: StoredAnchor[] = stage.anchors.map((anchor) => ({
        key: anchor.key,
        label: anchor.label,
        ...(anchor.description === undefined ? {} : { description: anchor.description }),
      }));
      const itemsByAnchor = new Map<string, string[]>();
      for (const item of await listStageItems(tx, stage.id)) {
        const list = itemsByAnchor.get(item.anchorKey) ?? [];
        list.push(item.name);
        itemsByAnchor.set(item.anchorKey, list);
      }
      try {
        anchorChange = {
          action: anchorWrites[0],
          ...computeAnchorChange(stored, itemsByAnchor, anchorWrites[0], guardStageFacing),
        };
      } catch (error) {
        if (!(error instanceof GameError)) {
          throw error;
        }
        return reject(`锚点变更被拒绝：${error.message}`, MEMORY_KINDS.actionRejected);
      }
    }

    const stageByName = new Map(stagesOfWorld.map((candidate) => [candidate.name, candidate]));
    for (const targetStageName of passages) {
      const target = stageByName.get(targetStageName);
      if (!target) {
        return reject("通道变更被拒绝：目标场景不存在。", MEMORY_KINDS.actionRejected);
      }
      if (!(await isPassageSealed(tx, world.id, stage.id, target.id))) {
        return reject(
          `通道变更被拒绝：没有从 ${stage.name} 到 ${target.name} 的未开启通道。`,
          MEMORY_KINDS.actionRejected,
        );
      }
    }
    for (const environment of environments) {
      try {
        guardStageFacing(environment, "environment");
      } catch (error) {
        if (!(error instanceof GameError)) {
          throw error;
        }
        return reject(`环境更新被拒绝：${error.message}`, MEMORY_KINDS.actionRejected);
      }
    }

    const now = new Date();
    for (const action of plan.actions) {
      await applyStageAction(tx, {
        gameId,
        world,
        stage,
        stageByName,
        anchorChange,
        action,
        trace,
      });
    }

    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

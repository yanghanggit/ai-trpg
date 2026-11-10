import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import type { TraceContext } from "../../debug/trace";
import { applyAnnounce } from "../actions/announce";
import { applyBrawl } from "../actions/brawl";
import { applyCall } from "../actions/call";
import { applyCleave } from "../actions/cleave";
import { applyEquip } from "../actions/equip";
import { applyGive } from "../actions/give";
import { applyInspect } from "../actions/inspect";
import { applyLoot } from "../actions/loot";
import { applyMove } from "../actions/move";
import { applyPickup } from "../actions/pickup";
import { applySay } from "../actions/say";
import { applySteal } from "../actions/steal";
import { applyStrike } from "../actions/strike";
import { applyTeleport } from "../actions/teleport";
import { applyUnequip } from "../actions/unequip";
import { applyUse } from "../actions/use";
import { applyWait } from "../actions/wait";
import { applyWhisper } from "../actions/whisper";
import type { AddressLookup } from "../addressing";
import { sanitizeActorFacingText } from "../addressing";
import {
  type AffixRequest,
  agentAffixes,
  type StaticOutcome,
  type StaticSettlement,
} from "../affixes";
import { GameError } from "../errors";
import { MAX_ACTIONS_PER_TURN } from "../limits";
import { isAlive, listStageActorRefs, loadRouteWorld, stageAddressLookup } from "../lookup";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import { bumpGameVersion } from "../persistence/games";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import { upsertSignatureName } from "../persistence/signature-names";
import { describeRoute, describeRouteFailure } from "../route";
import type { ActorPlan, CommunicationKind } from "../types";
import { resolvePlan } from "./resolve";
import { describeMemoryState } from "./state-snapshot";
import type { ResolvedAction, SettlePlanResult } from "./types";

/**
 * 结算的计算端：校验、解析、逐动作落账、写行动事实，全部在一个事务里。
 *
 * 事务外的事（词缀、外观、死亡收尾）在 `increment.ts`：那一端要调 LLM，失败不能回滚
 * 这次行动，所以必须先提交再补。
 */

/** 台词动作的行动反馈也带结构化台词信息；其他动作没有台词。 */
function dialogueFeedbackMetadata(action: ResolvedAction): {
  communicationKind?: CommunicationKind;
  dialogue?: string;
} {
  switch (action.kind) {
    case "say":
    case "whisper":
    case "announce":
    case "call":
      return { communicationKind: action.kind, dialogue: action.action.message };
    default:
      return {};
  }
}

/** 动作落账结果：反馈文本 + 静态词缀结算（供 agent 增量阶段使用）。 */
type ActionResult = {
  feedback: string;
  staticSettlement?: StaticSettlement;
  staticOutcome?: StaticOutcome;
};

/** 扁平 dispatch，没有分类层。 */
async function applyResolvedAction(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAction,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<ActionResult> {
  const plain = (feedback: string): ActionResult => ({ feedback });
  switch (resolved.kind) {
    case "say":
      return plain(await applySay(executor, gameId, actorRow, resolved, now, address, trace));
    case "whisper":
      return plain(await applyWhisper(executor, gameId, actorRow, resolved, now, address, trace));
    case "announce":
      return plain(await applyAnnounce(executor, gameId, actorRow, resolved, now, trace));
    case "call":
      return plain(await applyCall(executor, gameId, resolved, now, trace));
    case "move":
      return plain(await applyMove(executor, gameId, actorRow, resolved, now, trace));
    case "teleport":
      return plain(await applyTeleport(executor, gameId, actorRow, resolved, now, trace));
    case "wait":
      return plain(await applyWait(executor, gameId, actorRow, resolved, now, trace));
    case "strike": {
      const result = await applyStrike(executor, gameId, actorRow, resolved, now, address, trace);
      return {
        feedback: result.feedback,
        staticSettlement: result.settlement,
        staticOutcome: result.outcome,
      };
    }
    case "brawl":
      return plain(await applyBrawl(executor, gameId, actorRow, resolved, now, address, trace));
    case "cleave":
      // 横扫逐目标各结算一次静态词缀；agent 词缀阶段暂不跟进（见 `actions/cleave.ts`）。
      return plain(await applyCleave(executor, gameId, actorRow, resolved, now, address, trace));
    case "steal":
      return plain(await applySteal(executor, gameId, actorRow, resolved, now, address, trace));
    case "inspect":
      return plain(await applyInspect(executor, gameId, actorRow, resolved, now, address, trace));
    case "loot":
      return plain(await applyLoot(executor, gameId, actorRow, resolved, now, address, trace));
    case "give":
      return plain(await applyGive(executor, gameId, actorRow, resolved, now, address, trace));
    case "pickup":
      return plain(await applyPickup(executor, gameId, actorRow, resolved, now, trace));
    case "use": {
      const result = await applyUse(executor, gameId, actorRow, resolved, now, address, trace);
      return {
        feedback: result.feedback,
        staticSettlement: result.settlement,
        staticOutcome: result.outcome,
      };
    }
    case "equip":
      return plain(await applyEquip(executor, gameId, actorRow, resolved, now, trace));
    case "unequip":
      return plain(await applyUnequip(executor, gameId, actorRow, resolved, now, trace));
  }
}

function affixRequestFor(
  resolved: ResolvedAction,
  actorId: string,
  defaultFeedback: string,
  staticSettlement: StaticSettlement | undefined,
  staticOutcome: StaticOutcome | undefined,
): AffixRequest | null {
  if (resolved.kind !== "strike" && resolved.kind !== "use") {
    return null;
  }
  const trigger = resolved.kind === "strike" ? "strike" : "use";
  const item = resolved.kind === "strike" ? resolved.item : resolved.transferItem;
  if (agentAffixes(item, trigger).length === 0) {
    return null;
  }
  if (resolved.kind === "strike") {
    return {
      actorId,
      itemId: item.id,
      trigger,
      targetActorId: resolved.target.id,
      defaultFeedback,
      ...(staticSettlement ? { staticSettlement } : {}),
      ...(staticOutcome ? { staticOutcome } : {}),
    };
  }
  return {
    actorId,
    itemId: item.id,
    trigger,
    ...(resolved.target ? { targetActorId: resolved.target.id } : {}),
    ...(resolved.targetStage ? { targetStageId: resolved.targetStage.id } : {}),
    ...(resolved.targetAnchor ? { targetAnchor: resolved.targetAnchor } : {}),
    defaultFeedback,
    ...(staticSettlement ? { staticSettlement } : {}),
    ...(staticOutcome ? { staticOutcome } : {}),
  };
}

/** 一次计划落账的产出：结果，加上主体名（提交后的外观阶段要用）。 */
export type PlanSettlement = {
  result: SettlePlanResult;
  /** 事务里读到的 actor 名；计划被拒绝时没有。 */
  actorName?: string;
};

/**
 * 落账一个 actor 计划：一个事务，失败或拒绝整份丢弃。
 *
 * 拒绝也写进自己的记忆（带当时状态），因为「这轮没成」对 actor 是事实。
 */
export async function settlePlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  loopSuccess: boolean,
  trace?: TraceContext,
): Promise<PlanSettlement> {
  const affixRequests: AffixRequest[] = [];
  let actorName: string | undefined;
  const result: SettlePlanResult = await db.transaction(async (tx) => {
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
    actorName = actorRow.actor.name;
    if (!isAlive(actorRow.actor)) {
      throw new GameError("invalid_action", `actor 已死亡: ${actorRow.actor.name}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "actor", actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    /** 计划失败与被拒绝也带当时状态；状态取事务内当前最终状态。 */
    const appendMemoryResult = async (
      content: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      const state = await describeMemoryState(tx, gameId, actorId, world.id);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: state ? `${content}\n\n${state}` : content,
          metadata,
        },
      ]);
    };

    const plannedExtras =
      (plan?.identities?.length ?? 0) +
      (plan?.routes?.length ?? 0) +
      (plan?.routeFailures?.length ?? 0);
    if (!plan || (plan.actions.length === 0 && plannedExtras === 0)) {
      await appendMemoryResult("# 行动结果\n本轮没有提交有效行动计划，状态未改变。", {
        kind: MEMORY_KINDS.planFailed,
        loopSuccess,
      });
      return {
        ok: false,
        rejection: "本轮没有提交有效行动计划",
        rejectionCode: MEMORY_KINDS.planFailed,
      };
    }

    if (plan.actions.length > MAX_ACTIONS_PER_TURN) {
      const rejection = `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动，实际提交 ${plan.actions.length} 个`;
      await appendMemoryResult(`# 行动结果\n行动被拒绝：${rejection}。`, {
        kind: MEMORY_KINDS.actionRejected,
      });
      return { ok: false, rejection, rejectionCode: MEMORY_KINDS.actionRejected };
    }

    let resolved: Awaited<ReturnType<typeof resolvePlan>>;
    try {
      resolved = await resolvePlan(tx, world, actorRow, plan);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      // 写进记忆的那份要脱敏：CLI/trace 保留名字，actor 记忆只留引用。
      const rejectionAddress = await stageAddressLookup(
        tx,
        gameId,
        actorRow.actor.id,
        actorRow.stage.id,
      );
      const rejectionForMemory = sanitizeActorFacingText(
        error.message,
        await listStageActorRefs(tx, actorRow.stage.id),
        rejectionAddress,
        [],
        { resolveHandles: false },
      );
      await appendMemoryResult(`# 行动结果\n行动被拒绝：${rejectionForMemory}`, {
        kind: MEMORY_KINDS.actionRejected,
      });
      return {
        ok: false,
        rejection: error.message,
        rejectionCode: MEMORY_KINDS.actionRejected,
      };
    }

    const now = new Date();
    const address = await stageAddressLookup(tx, gameId, actorRow.actor.id, actorRow.stage.id);
    const stageActorRefs = await listStageActorRefs(tx, actorRow.stage.id);
    const applied: { event: "applied"; actionKind: string; feedback: string }[] = [];
    const pendingMemory: { content: string; metadata: Record<string, unknown> }[] = [];
    for (const action of resolved.actions) {
      const result = await applyResolvedAction(tx, gameId, actorRow, action, now, address, trace);
      const { feedback } = result;
      applied.push({ event: "applied", actionKind: action.kind, feedback });
      const affixRequest = affixRequestFor(
        action,
        actorRow.actor.id,
        feedback,
        result.staticSettlement,
        result.staticOutcome,
      );
      if (affixRequest) {
        affixRequests.push(affixRequest);
      }
      const dialogue = dialogueFeedbackMetadata(action);
      pendingMemory.push({
        // 台词原文是角色说出口的内容，保留原样；只有非台词的反馈才做名字脱敏。
        content:
          dialogue.dialogue === undefined
            ? sanitizeActorFacingText(feedback, stageActorRefs, address, [], {
                resolveHandles: false,
              })
            : feedback,
        metadata: {
          kind: MEMORY_KINDS.actionFeedback,
          ...dialogue,
        },
      });
    }

    // 名字更新：只写自己的记忆，不产生公共事件；与动作同事务，失败整份丢弃。
    for (const identity of resolved.identities) {
      await upsertSignatureName(
        tx,
        {
          gameId,
          observerActorId: actorRow.actor.id,
          signatureId: identity.signatureId,
          name: identity.name,
          source: "self",
          learnedStageId: actorRow.stage.id,
        },
        now,
      );
      pendingMemory.push({
        content: `# 认知\n你把 ${identity.handle} 记作「${identity.name}」。`,
        metadata: { kind: MEMORY_KINDS.identityUpdate },
      });
    }
    // 认知两类（回忆路线 / 寻路失败）共用一次窄读。
    // 路线链上的 `#序号` 依赖它，文案由引擎重算，不采信模型转述的文本。
    const knowledge =
      resolved.routes.length > 0 || resolved.routeFailures.length > 0
        ? await loadRouteWorld(tx, {
            gameId,
            worldId: world.id,
            actorId,
            currentStageId: actorRow.stage.id,
          })
        : undefined;

    // 认知写进状态的部分（`signatureNames`）没有动作替它推动版本；
    // 只有认知的空手计划必须自己 bump，否则这次写入对 `expectedVersion` 是隐形的。
    // 有计划内动作时版本已经动过，不重复计一次；纯记忆的路线不在 GameState 里，不算。
    if (resolved.identities.length > 0 && resolved.actions.length === 0) {
      await bumpGameVersion(tx, gameId, now);
    }

    // 路线回忆只写自己的记忆：与动作同事务，引擎重算，不采信模型或调用方转述的文本。
    if (knowledge) {
      for (const route of resolved.routes) {
        pendingMemory.push({
          content: `# 认知\n${describeRoute(knowledge, route)}`,
          metadata: { kind: MEMORY_KINDS.routeRecall },
        });
      }
      // 寻路失败也是一次回忆的结论：“这里我认不出来”。不透露地形，只说输入对不上。
      for (const failure of resolved.routeFailures) {
        pendingMemory.push({
          content: `# 认知\n${describeRouteFailure(knowledge, failure)}`,
          metadata: { kind: MEMORY_KINDS.routeFailed },
        });
      }
    }

    // 一次计划的最后一条 memory 带落账后的状态；识名更新也算计划结果的一部分。
    const state = await describeMemoryState(tx, gameId, actorId, world.id);
    const last = pendingMemory.at(-1);
    if (last && state) {
      last.content = `${last.content}\n\n${state}`;
    }
    if (pendingMemory.length > 0) {
      await appendMemoryMessages(
        tx,
        memory.row.id,
        pendingMemory.map((message) => ({ type: "human" as const, ...message })),
      );
    }

    return {
      ok: true,
      affixRequests,
      applied,
    };
  });

  return actorName === undefined ? { result } : { result, actorName };
}

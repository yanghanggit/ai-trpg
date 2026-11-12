import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import { type TraceContext, traceEvent } from "../../debug/trace";
import { type ActionResult, type ApplyContext, actionSpec } from "../actions/registry";
import { announceReveal } from "../actions/reveal";
import type { AffixRequest } from "../agents/affixes";
import { GameError } from "../errors";
import { type AddressLookup, sanitizeActorFacingText } from "../kernel/addressing";
import { MAX_ACTIONS_PER_TURN } from "../kernel/limits";
import type { ActorPlan, CommunicationKind } from "../kernel/types";
import { isAlive, listStageActorRefs, stageAddressLookup } from "../lookup";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import { setActorConcealed } from "../persistence/actors";
import { bumpGameVersion } from "../persistence/games";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import { upsertSignatureName } from "../persistence/signature-names";
import { describeRoute, describeRouteFailure, loadRouteWorld } from "../route";
import { resolvePlan } from "./resolve";
import { describeMemoryState } from "./state-snapshot";
import type { ResolvedAction, SettlePlanResult } from "./types";

/**
 * 结算的计算端：校验、解析、逐动作落账、写行动事实，全部在一个事务里。
 *
 * 事务外的事（词缀、外观、死亡收尾）在 `increment.ts`：那一端要调 LLM，失败不能回滚
 * 这次行动，所以必须先提交再补。
 */

/** 带台词的动作用集合表达，不再逐个 case。 */
const DIALOGUE_KINDS: ReadonlySet<string> = new Set<CommunicationKind>([
  "say",
  "whisper",
  "announce",
  "call",
]);

/** 台词动作的行动反馈也带结构化台词信息；其他动作没有台词。 */
function dialogueFeedbackMetadata(action: ResolvedAction): {
  communicationKind?: CommunicationKind;
  dialogue?: string;
} {
  if (!DIALOGUE_KINDS.has(action.kind)) {
    return {};
  }
  return {
    communicationKind: action.kind as CommunicationKind,
    dialogue: (action.action as { message: string }).message,
  };
}

/** 扁平调度：按 kind 查表，没有分类层。 */
async function applyResolvedAction(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAction,
  now: Date,
  address: AddressLookup,
  ambush: boolean,
  trace?: TraceContext,
): Promise<ActionResult> {
  const context: ApplyContext = {
    executor,
    gameId,
    actorRow,
    now,
    address,
    ...(ambush ? { ambush: true } : {}),
    ...(trace ? { trace } : {}),
  };
  return actionSpec(resolved.kind).apply(context, resolved);
}

/** 认知条目只记结论，不拼「落账后的状态」。 */
const COGNITION_KINDS: readonly string[] = [
  MEMORY_KINDS.identityUpdate,
  MEMORY_KINDS.routeRecall,
  MEMORY_KINDS.routeFailed,
];

/**
 * 认知是「谁叫什么」「某地怎么走」这类不随现场变化的结论；`# 当时` 记的是舞台、在场者与
 * 可交互物，随时间与人员变动失真，拼在认知里只会误导。真正的「当时」需要世界级的时间
 * 与推进计数，等那套标记落地再补，现在不在认知条目上假装有时态。
 */
function isCognition(metadata: Record<string, unknown>): boolean {
  const kind = metadata.kind;
  return typeof kind === "string" && COGNITION_KINDS.includes(kind);
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
    const applied: {
      event: "applied";
      actionKind: string;
      feedback: string;
      affectsAppearance?: boolean;
      revealed?: boolean;
    }[] = [];
    const pendingMemory: { content: string; metadata: Record<string, unknown> }[] = [];
    for (const action of resolved.actions) {
      const spec = actionSpec(action.kind);
      // 逐动作取当时的舞台地址：动作组合里先 move / teleport 再说话时，后一个动作的
      // 引用必须按它自己的舞台重算；上限放开后也不会拿旧舞台的地址表落账。
      const address = await stageAddressLookup(tx, gameId, actorRow.actor.id, action.stage.id);
      const stageActorRefs = await listStageActorRefs(tx, action.stage.id);
      // 隐式前置：隐匿中执行会暴露的动作，先解除隐匿再落账；不占行动名额，也不插入
      // 一条真实的 reveal 动作。动作本身写给舞台时由它的观察承载，只写给目标时补一条
      // 舞台可见的「现身」事实。
      const revealed = actorRow.actor.concealed && (spec.reveals?.(action) ?? false);
      if (revealed) {
        await setActorConcealed(tx, actorRow.actor.id, false, now);
        actorRow.actor.concealed = false;
        if (spec.revealEvent) {
          await announceReveal(tx, gameId, actorRow, action.stage, trace);
        }
      }
      const result = await applyResolvedAction(
        tx,
        gameId,
        actorRow,
        action,
        now,
        address,
        revealed,
        trace,
      );
      if (revealed) {
        result.feedback = `${result.feedback}\n你从暗处现身了。`;
        await traceEvent(trace, {
          event: "phase",
          name: "concealment",
          status: "ok",
          actorName: actorRow.actor.name,
          detail: { actionKind: action.kind, concealed: false, via: "auto" },
        });
      }
      // 一次行动一条记忆：标题只写一次，多目标的句子并排在同一块里。
      const feedback = `# 行动结果\n${result.feedback}`;
      applied.push({
        event: "applied",
        actionKind: action.kind,
        feedback,
        ...(revealed ? { revealed: true } : {}),
        ...(result.affectsAppearance === undefined
          ? {}
          : { affectsAppearance: result.affectsAppearance }),
      });
      const affixRequest = spec.affixRequest?.(action, {
        actorId: actorRow.actor.id,
        // 提示词自己排「动作结果」段，交进去的是句子，不带记忆标题。
        defaultFeedback: result.feedback,
        ...(result.staticSettlement ? { staticSettlement: result.staticSettlement } : {}),
        ...(result.staticOutcomes ? { staticOutcomes: result.staticOutcomes } : {}),
      });
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

    // 一次写入事务只推一次版本：动过 GameState（动作落账、或只改名写 `signatureNames`）
    // 就推；纯记忆的路线与拒绝不进 GameState，不推。
    if (resolved.actions.length > 0 || resolved.identities.length > 0) {
      await bumpGameVersion(tx, gameId, now);
    }

    // 路线回忆只写自己的记忆：与动作同事务，引擎重算，不采信模型或调用方转述的文本。
    // `routeTo` / `routeToRef` 是压缩回收时的去重键：同一目的地只留最新一条结论。
    if (knowledge) {
      for (const route of resolved.routes) {
        pendingMemory.push({
          content: `# 认知\n${describeRoute(knowledge, route)}`,
          metadata: {
            kind: MEMORY_KINDS.routeRecall,
            routeFrom: route.fromStageId,
            routeTo: route.toStageId,
          },
        });
      }
      // 寻路失败也是一次回忆的结论：“这里我认不出来”。不透露地形，只说输入对不上。
      for (const failure of resolved.routeFailures) {
        pendingMemory.push({
          content: `# 认知\n${describeRouteFailure(knowledge, failure)}`,
          metadata: {
            kind: MEMORY_KINDS.routeFailed,
            ...(failure.fromStageId === undefined ? {} : { routeFrom: failure.fromStageId }),
            routeToRef: failure.toStageRef,
          },
        });
      }
    }

    // 落账后的状态挂在最后一条行动记忆上；整轮只有认知时不挂。
    const state = await describeMemoryState(tx, gameId, actorId, world.id);
    const carrier = [...pendingMemory].reverse().find((message) => !isCognition(message.metadata));
    if (carrier && state) {
      carrier.content = `${carrier.content}\n\n${state}`;
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

import type { Database } from "../../db/pool";
import { createTurnTrace, traceEvent } from "../../debug/trace";
import { findActorByName, findActorByRef, stageOfActor } from "../actor-state";
import { dialogueContextFor, isDialogueAction } from "../agents/dialogue-audit";
import { GameError } from "../errors";
import { getGameStateSlice, readTurnDelivery } from "../game-state";
import { addressLookupFor } from "../kernel/addressing";
import type {
  ActorAction,
  ActorPlan,
  ActorState,
  ActorTurnResult,
  GameStateSlice,
  StageState,
} from "../kernel/types";
import { MEMORY_KINDS } from "../memory/kinds";
import { isPlayerControlled } from "../persistence/actor-controls";
import { settleActorPlan } from "../settle";
import { auditDialogueOrThrow } from "./audit";
import type { PlayerActionOptions } from "./inputs";

/**
 * 玩家入口是 god view，可以用真名 / 引用指定目标；但进入结算前必须
 * 换成该 actor 当前地址表发出的 actor-facing 引用，后续只走签名 / 当前名字入口。
 */
function normalizePlayerTargets(
  state: GameStateSlice,
  actor: ActorState,
  stage: StageState,
  plan: ActorPlan,
): ActorPlan {
  const address = addressLookupFor(state, actor, stage);
  return {
    ...plan,
    actions: plan.actions.map((action) => {
      if (!("targetActorHandle" in action) || !action.targetActorHandle) {
        return action;
      }
      const target = findActorByRef(state, action.targetActorHandle);
      const token = address(target.id).token;
      if (token.length === 0) {
        throw new GameError("invalid_action", `当前场景内找不到引用: ${action.targetActorHandle}`);
      }
      return { ...action, targetActorHandle: token };
    }),
  };
}

/** 没有动作的计划用认知类别做轨迹标签；顺序与落账顺序一致。 */
function extraLabel(plan: ActorPlan): string {
  if ((plan.identities?.length ?? 0) > 0) {
    return MEMORY_KINDS.identityUpdate;
  }
  if ((plan.routes?.length ?? 0) > 0) {
    return MEMORY_KINDS.routeRecall;
  }
  if ((plan.routeFailures?.length ?? 0) > 0) {
    return MEMORY_KINDS.routeFailed;
  }
  return "empty_plan";
}

/** 单个动作的便捷入口，内部仍走同一份计划。 */
export async function applyPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: ActorAction,
  options: PlayerActionOptions = {},
): Promise<ActorTurnResult> {
  return applyPlayerPlan(db, gameRef, actorRef, { actions: [action] }, options);
}

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
export async function applyPlayerPlan(
  db: Database,
  gameRef: string,
  actorRef: string,
  plan: ActorPlan,
  options: PlayerActionOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  return applyPlayerPlanOnState(db, state, findActorByRef(state, actorRef), plan, options);
}

/**
 * 已装载状态上的计划执行。
 *
 * 需要先看状态再决定计划的入口（例如改称呼要先解析目标）复用这一层，
 * 避免为同一份状态装配两遍。
 */
export async function applyPlayerPlanOnState(
  db: Database,
  state: GameStateSlice,
  actor: ActorState,
  plan: ActorPlan,
  options: PlayerActionOptions = {},
): Promise<ActorTurnResult> {
  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const { stage } = stageOfActor(state, actor.id);
  // 台词审核要看目标是谁，必须用**玩家原本写的真名 / 编号**解析：
  // 地址一归一成观察者称呼，就不再是真名了。
  const dialogue = plan.actions.find(isDialogueAction);
  const dialogueTarget = dialogue
    ? dialogue.kind === "announce"
      ? null
      : dialogue.kind === "call"
        ? findActorByName(state, dialogue.targetActorName).actor
        : findActorByRef(state, dialogue.targetActorHandle)
    : null;
  plan = normalizePlayerTargets(state, actor, stage, plan);
  const trace = createTurnTrace({ game: state.game, turnKind: "player" });
  await traceEvent(trace, {
    event: "turn_start",
    label: plan.actions[0]?.kind ?? extraLabel(plan),
    actorId: actor.id,
    actorName: actor.name,
    stageId: stage.id,
    stageName: stage.name,
    contentVersion: state.game.contentVersion,
  });
  if (dialogue) {
    await auditDialogueOrThrow({
      db,
      trace,
      context: dialogueContextFor(
        state,
        actor,
        stage?.name ?? "",
        dialogue,
        dialogueTarget?.id ?? null,
      ),
      ...(options.judge ? { judge: options.judge } : {}),
    });
  }

  // 只挑结算认得的字段：`judge` 是玩家入口的台词审核，结算不读它。
  const result = await settleActorPlan(db, state.game.id, actor.id, plan, true, {
    ...(options.service ? { service: options.service } : {}),
    ...(options.inferenceService ? { inferenceService: options.inferenceService } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.auditNameLeaks === undefined ? {} : { auditNameLeaks: options.auditNameLeaks }),
    ...(trace ? { trace } : {}),
  });
  await traceEvent(trace, { event: "turn_end", ok: result.ok, loopSuccess: true });
  if (!result.ok) {
    throw new GameError("invalid_action", result.rejection ?? "玩家行动被拒绝");
  }

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok: true,
    plan,
    loopSuccess: true,
    ...(result.death ? { death: result.death } : {}),
  };
}

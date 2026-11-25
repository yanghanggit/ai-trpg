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
 * 玩家入口的回合：一个动作，或者一次纯认知。
 *
 * 「一个回合一个动作」是形状上的约束，不是调用约定：这里没有能装下一串动作的入口。
 * 形状本身仍是 `ActorPlan`——落账与记忆只有一份，玩家入口只是跳过计划与工具，
 * 把已经决定好的那一条喂给同一个结算层（见 `docs/actor-actions-memory.md`）。
 */
export type PlayerCognition = Partial<Pick<ActorPlan, "identities" | "routes" | "routeFailures">>;

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
        throw new GameError("invalid_action", `当前舞台内找不到引用: ${action.targetActorHandle}`);
      }
      return { ...action, targetActorHandle: token };
    }),
  };
}

/** 没有动作的回合用认知类别做轨迹标签；顺序与落账顺序一致。 */
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

/** 玩家动作：一个动作就是一个回合。 */
export async function applyPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: ActorAction,
  options: PlayerActionOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  return settlePlayerTurnOnState(
    db,
    state,
    findActorByRef(state, actorRef),
    { actions: [action] },
    options,
  );
}

/**
 * 玩家替自己控制的角色记一条认知：改名或回忆路线。
 *
 * 它不占动作名额，但同样是一个回合——计数只看「这个回合发生过」，不看里面有几个动作。
 */
export async function applyPlayerCognitionOnState(
  db: Database,
  state: GameStateSlice,
  actor: ActorState,
  cognition: PlayerCognition,
  options: PlayerActionOptions = {},
): Promise<ActorTurnResult> {
  return settlePlayerTurnOnState(db, state, actor, { actions: [], ...cognition }, options);
}

/**
 * 一个已决定的回合走同一份结算路径；计划只在这里就近组装，不给外部传入的机会。
 *
 * 需要先看状态再决定动作的入口（例如改称呼要先解析目标）复用这一层，
 * 避免为同一份状态装配两遍。
 */
async function settlePlayerTurnOnState(
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
  const dialogueTarget =
    dialogue === undefined
      ? null
      : dialogue.kind === "announce"
        ? null
        : dialogue.kind === "call"
          ? findActorByName(state, dialogue.targetActorName).actor
          : findActorByRef(state, dialogue.targetActorHandle);
  plan = normalizePlayerTargets(state, actor, stage, plan);
  // 轨迹由调用方开就沿用那一条：推进对账要挂在同一个回合上，不能自成一条孤立记录。
  const trace = options.trace ?? createTurnTrace({ game: state.game, turnKind: "player" });
  await traceEvent(trace, {
    event: "turn_start",
    label: plan.actions[0]?.kind ?? extraLabel(plan),
    actorId: actor.id,
    actorName: actor.name,
    stageId: stage.id,
    stageName: stage.name,
    contentVersion: state.game.contentVersion,
  });
  if (dialogue !== undefined) {
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

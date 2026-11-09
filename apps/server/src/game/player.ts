import type { Database } from "../db/pool";
import { createTurnTrace, traceEvent } from "../debug/trace";
import { parseCall } from "./actions/call";
import { parseTeleport } from "./actions/teleport";
import { findActorByName, findActorByRef, stageOfActor } from "./actors";
import { addressLookupFor } from "./addressing";
import { type ApplyActorPlanOptions, applyActorPlan } from "./apply";
import { MEMORY_KINDS } from "./constants";
import { isPlayerControlled } from "./control";
import { auditPlayerDialogue, dialogueContextFor, isDialogueAction } from "./dialogue-audit";
import { DialogueBlockedError, GameError } from "./errors";
import { parseSignatureName } from "./plan";
import { getGameStateSlice, readTurnDelivery } from "./read/game-state";
import { handleOf } from "./reference";
import { type RouteQuestion, resolveRouteQuestion } from "./route";
import type {
  ActorAction,
  ActorPlan,
  ActorState,
  ActorTurnResult,
  EquipmentSlot,
  GameStateSlice,
  StageState,
} from "./types";

/**
 * 玩家入口是 god view，可以用真名 / 引用指定目标；但进入 apply 前必须
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

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
async function applyPlayerPlan(
  db: Database,
  gameRef: string,
  actorRef: string,
  plan: ActorPlan,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  return applyPlayerPlanOnState(db, state, findActorByRef(state, actorRef), plan, options);
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

/**
 * 已装载状态上的计划执行。
 *
 * 需要先看状态再决定计划的入口（例如改称呼要先解析目标）复用这一层，
 * 避免为同一份状态装配两遍。
 */
async function applyPlayerPlanOnState(
  db: Database,
  state: GameStateSlice,
  actor: ActorState,
  plan: ActorPlan,
  options: ApplyActorPlanOptions = {},
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
    const audit = await auditPlayerDialogue(
      db,
      dialogueContextFor(state, actor, stage?.name ?? "", dialogue, dialogueTarget?.id ?? null),
      options.judge,
    );
    await traceEvent(trace, {
      event: "dialogue_audit",
      allowed: audit.allowed,
      reason: audit.reason,
      categories: audit.categories,
      ...(audit.failureKind ? { failureKind: audit.failureKind } : {}),
      ...(audit.auditId ? { auditId: audit.auditId } : {}),
      latencyMs: audit.latencyMs,
      model: audit.model,
      contentHash: audit.contentHash,
    });
    if (!audit.allowed) {
      await traceEvent(trace, { event: "turn_end", ok: false, loopSuccess: true });
      throw new DialogueBlockedError({
        httpStatus: audit.failureKind ? 503 : 422,
        reason: audit.reason,
        categories: audit.categories,
        ...(audit.failureKind ? { failureKind: audit.failureKind } : {}),
        auditId: audit.auditId ?? "",
      });
    }
  }

  const result = await applyActorPlan(db, state.game.id, actor.id, plan, true, {
    ...options,
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

/** 单个动作的便捷入口，内部仍走同一份计划。 */
async function applyPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: ActorAction,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  return applyPlayerPlan(db, gameRef, actorRef, { actions: [action] }, options);
}

/**
 * 玩家入口的通用引用。接受三种写法：
 * - `actor.id`：稳定身份，客户端首选；
 * - 名字（如 `某甲`）：给人工操作与 CLI 用；
 * - 引用（如 `@某甲` / `#3`）：复用 agent 视角时用。
 *
 * 玩家入口是 god view，与模型工具不同：模型只能看到引用。
 */
/**
 * 说话动作的服务层输入。
 *
 * `reason`（对应 agent 的 mind）只给开发期 agent / CLI 接管使用；
 * 正式 web 客户端的 DTO 不暴露该字段，路由调用时直接省略。
 */
export type PlayerTalkInput = {
  message: string;
  targetActorRef: string;
  reason?: string;
};

/** 同 `PlayerTalkInput`：`reason` 只属于 agent / CLI 接管，不属于 web 客户端。 */
export type PlayerAnnounceInput = {
  message: string;
  reason?: string;
};

/** 跨场景传音；`targetActorName` 必须是真名，不接受引用或 id。 */
export type PlayerCallInput = {
  message: string;
  targetActorName: string;
  reason?: string;
};

export type PlayerMoveInput = {
  /** 场景 id、名字或 `#编号`。 */
  targetStageRef: string;
};

export type PlayerTeleportInput = {
  /** 目标场景的真名；`#编号` 与 id 都不接受，服务端另校验「这个 actor 知道这个真名」。 */
  targetStageRef: string;
};

export type PlayerStrikeInput = {
  targetActorRef: string;
};

export type PlayerBrawlInput = {
  targetActorRef: string;
};

export type PlayerStealInput = {
  targetActorRef: string;
  itemName: string;
};

export type PlayerInspectInput = {
  targetActorRef: string;
};

export type PlayerLootInput = {
  targetActorRef: string;
  /** 省略表示搜刮尸体身上的全部物品。 */
  itemNames?: string[];
};

export type PlayerGiveInput = {
  targetActorRef: string;
  itemName: string;
};

export type PlayerPickupInput = {
  targetAnchor: string;
  itemName: string;
};

export type PlayerEquipInput = {
  itemName: string;
  slot: EquipmentSlot;
};

export type PlayerUnequipInput = {
  slot: EquipmentSlot;
};

export type PlayerUseInput = {
  itemName: string;
  targetActorRef?: string;
  targetStageName?: string;
  targetAnchor?: string;
};

function playerMind(reason: string | undefined): string {
  return reason?.trim() || "玩家直接提交";
}

export async function playerSay(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerTalkInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "say",
    mind: playerMind(input.reason),
    targetActorHandle: input.targetActorRef,
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerWhisper(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerTalkInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "whisper",
    mind: playerMind(input.reason),
    targetActorHandle: input.targetActorRef,
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerAnnounce(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerAnnounceInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "announce",
    mind: playerMind(input.reason),
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerCall(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerCallInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action = parseCall({
    mind: playerMind(input.reason),
    targetActorName: input.targetActorName,
    message: input.message,
  });
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerMove(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerMoveInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "move", targetStageName: input.targetStageRef };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerTeleport(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerTeleportInput,
): Promise<ActorTurnResult> {
  // 玩家入口与模型工具共用同一份参数校验：`#编号` 在这里就该被拒。
  const action: ActorAction = parseTeleport({ targetStageName: input.targetStageRef });
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerWait(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "wait" };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerStrike(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerStrikeInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "strike",
    targetActorHandle: input.targetActorRef,
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerBrawl(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerBrawlInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "brawl",
    targetActorHandle: input.targetActorRef,
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerSteal(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerStealInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "steal",
    targetActorHandle: input.targetActorRef,
    itemName: input.itemName,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerInspect(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerInspectInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "inspect",
    targetActorHandle: input.targetActorRef,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerLoot(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerLootInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "loot",
    targetActorHandle: input.targetActorRef,
    ...(input.itemNames === undefined ? {} : { itemNames: input.itemNames }),
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerGive(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerGiveInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "give",
    targetActorHandle: input.targetActorRef,
    itemName: input.itemName,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerPickup(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerPickupInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "pickup",
    targetAnchor: input.targetAnchor,
    itemName: input.itemName,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerEquip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerEquipInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "equip", itemName: input.itemName, slot: input.slot };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

export async function playerUnequip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerUnequipInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "unequip", slot: input.slot };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

/** 玩家替自己控制的角色记下一个名字；与模型侧的名字更新走同一份计划。 */
export type PlayerRecognizeInput = {
  /** 目标引用：真名或 `#编号`；玩家入口仍走控制面。 */
  targetActorRef: string;
  /** 角色当前想怎么称呼对方；不必是真名。 */
  name: string;
};

export async function playerRecognizeIdentity(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerRecognizeInput,
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const target = findActorByRef(state, input.targetActorRef);
  const plan: ActorPlan = {
    actions: [],
    identities: [{ handle: handleOf(target.signature.seq), name: parseSignatureName(input.name) }],
  };
  return applyPlayerPlanOnState(db, state, actor, plan);
}

/** 玩家替自己控制的角色回忆一条路线；结论只进自己的认知，不占行动名额。 */
export async function playerRecallRoute(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: RouteQuestion,
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const resolution = resolveRouteQuestion(state, stageOfActor(state, actor.id), input);
  // 地名对不上也是一次回忆的结论：落成「无法寻路」的认知，而不是把整个回合判成失败。
  const plan: ActorPlan = resolution.ok
    ? { actions: [], routes: [resolution.query] }
    : { actions: [], routeFailures: [resolution.failure] };
  return applyPlayerPlanOnState(db, state, actor, plan);
}

export async function playerUse(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerUseInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "use",
    itemName: input.itemName,
    ...(input.targetActorRef !== undefined ? { targetActorHandle: input.targetActorRef } : {}),
    ...(input.targetStageName !== undefined ? { targetStageName: input.targetStageName } : {}),
    ...(input.targetAnchor !== undefined ? { targetAnchor: input.targetAnchor } : {}),
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

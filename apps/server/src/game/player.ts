import type { Database } from "../db/pool";
import { createTurnTrace, traceEvent } from "../debug/trace";
import { findActor } from "./actors";
import { handleOf } from "./addressing";
import { type ApplyActorPlanOptions, applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { auditPlayerDialogue, dialogueContextFor, isDialogueAction } from "./dialogue-audit";
import { DialogueBlockedError, GameError } from "./errors";
import { parseIdentityName } from "./plan";
import { getGameState } from "./service";
import type {
  ActorAction,
  ActorPlan,
  ActorState,
  ActorTurnResult,
  EquipmentSlot,
  GameState,
} from "./types";

/** 客户端可以用 id、规范名或 `@N` 指代目标；与玩家入口的寻址约定一致。 */
function findActorByRef(state: GameState, ref: string): ActorState {
  if (!ref.startsWith("@")) {
    return findActor(state, ref);
  }
  const seq = Number(ref.slice(1));
  const actor = state.world.stages
    .flatMap((stage) => stage.actors)
    .find((candidate) => candidate.presentation.seq === seq);
  if (!actor) {
    throw new GameError("not_found", `没有这个指代: ${ref}`);
  }
  return actor;
}

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
async function applyPlayerPlan(
  db: Database,
  gameRef: string,
  actorRef: string,
  plan: ActorPlan,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const stage = state.world.stages.find((candidate) =>
    candidate.actors.some((entry) => entry.id === actor.id),
  );
  const trace = createTurnTrace({ game: state.game, turnKind: "player" });
  await traceEvent(trace, {
    event: "turn_start",
    label: plan.actions[0]?.kind ?? "identity_update",
    actorId: actor.id,
    actorName: actor.name,
    ...(stage ? { stageId: stage.id, stageName: stage.name } : {}),
    contentVersion: state.game.contentVersion,
  });
  const dialogue = plan.actions.find(isDialogueAction);
  if (dialogue) {
    const target =
      dialogue.kind === "announce" ? null : findActorByRef(state, dialogue.targetActorHandle);
    const audit = await auditPlayerDialogue(
      db,
      dialogueContextFor(state, actor, stage?.name ?? "", dialogue, target?.id ?? null),
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
    ok: true,
    plan,
    loopSuccess: true,
    state: await getGameState(db, state.game.id),
    ...(result.death ? { death: result.death } : {}),
    ...(result.identityWarnings ? { identityWarnings: result.identityWarnings } : {}),
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
 * - 规范名（如 `角色.某甲`）：给人工操作与 CLI 用；
 * - 系统指代（如 `@3`）：复用 agent 视角时用。
 *
 * 玩家入口是 god view，与模型工具不同：模型只能看到 `@` 指代。
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

export type PlayerMoveInput = {
  /** 场景 id 或规范名；裸名不由服务端解析。 */
  targetStageRef: string;
};

export type PlayerTeleportInput = {
  /** 目标场景 id 或规范名；必须是 actor 去过的场景。 */
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

export type PlayerGiveInput = {
  targetActorRef: string;
  itemName: string;
};

export type PlayerPickupInput = {
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
  targetDetail?: string;
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
  const action: ActorAction = { kind: "teleport", targetStageName: input.targetStageRef };
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
  const action: ActorAction = { kind: "pickup", itemName: input.itemName };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerEquip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerEquipInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "equip", itemName: input.itemName, slot: input.slot };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerUnequip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerUnequipInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "unequip", slot: input.slot };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

/** 玩家替自己控制的角色记下一个称呼；与模型侧的认知更新走同一份计划。 */
export type PlayerRememberInput = {
  /** 目标引用：id、规范名或 `@N`。 */
  targetActorRef: string;
  /** 角色相信对方叫什么。 */
  name: string;
};

export async function playerRememberIdentity(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerRememberInput,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const target = findActorByRef(state, input.targetActorRef);
  const plan: ActorPlan = {
    actions: [],
    identities: [
      { handle: handleOf(target.presentation.seq), name: parseIdentityName(input.name) },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
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
    ...(input.targetDetail !== undefined ? { targetDetail: input.targetDetail } : {}),
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

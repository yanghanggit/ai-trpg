import type { Database } from "../db/pool";
import { findActor } from "./actors";
import { type ApplyActorPlanOptions, applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { getGameState } from "./service";
import type { ActorAction, ActorPlan, ActorTurnResult, EquipmentSlot } from "./types";

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
async function applyPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: ActorAction,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const plan: ActorPlan = { actions: [action] };
  const result = await applyActorPlan(db, state.game.id, actor.id, plan, [], true, options);
  if (!result.ok) {
    throw new GameError("invalid_action", result.rejection ?? "玩家行动被拒绝");
  }

  return {
    ok: true,
    plan,
    loopSuccess: true,
    state: await getGameState(db, state.game.id),
    ...(result.death ? { death: result.death } : {}),
  };
}

/** 玩家提交的说话动作；`reason` 对应工具里的 mind，省略时用固定文案。 */
export type PlayerTalkInput = {
  message: string;
  targetActorName: string;
  reason?: string;
};

export type PlayerAnnounceInput = {
  message: string;
  reason?: string;
};

export type PlayerMoveInput = {
  targetStageName: string;
};

export type PlayerAttackInput = {
  targetActorName: string;
};

export type PlayerStealInput = {
  targetActorName: string;
  itemName: string;
};

export type PlayerGiveInput = {
  targetActorName: string;
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
  targetActorName?: string;
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
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "say",
    mind: playerMind(input.reason),
    targetActorName: input.targetActorName,
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerWhisper(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerTalkInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "whisper",
    mind: playerMind(input.reason),
    targetActorName: input.targetActorName,
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerAnnounce(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerAnnounceInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "announce",
    mind: playerMind(input.reason),
    message: input.message,
  };
  return applyPlayerAction(db, gameRef, actorRef, action);
}

export async function playerMove(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerMoveInput,
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "move", targetStageName: input.targetStageName };
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

export async function playerAttack(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerAttackInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "attack",
    targetActorName: input.targetActorName,
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
    targetActorName: input.targetActorName,
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
    targetActorName: input.targetActorName,
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
    ...(input.targetActorName !== undefined ? { targetActorName: input.targetActorName } : {}),
    ...(input.targetStageName !== undefined ? { targetStageName: input.targetStageName } : {}),
    ...(input.targetDetail !== undefined ? { targetDetail: input.targetDetail } : {}),
  };
  return applyPlayerAction(db, gameRef, actorRef, action, options);
}

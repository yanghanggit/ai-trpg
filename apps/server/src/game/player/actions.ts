import type { Database } from "../../db/pool";
import { parseCall } from "../actions/call";
import { parseTeleport } from "../actions/teleport";
import { findActorByRef, stageOfActor } from "../actor-state";
import type { ApplyActorPlanOptions } from "../apply";
import { parseSignatureName } from "../plan";
import { getGameStateSlice } from "../read/game-state";
import { handleOf } from "../reference";
import { type RouteQuestion, resolveRouteQuestion } from "../route";
import type { ActorAction, ActorPlan, ActorTurnResult } from "../types";
import type {
  PlayerAnnounceInput,
  PlayerBrawlInput,
  PlayerCallInput,
  PlayerEquipInput,
  PlayerGiveInput,
  PlayerInspectInput,
  PlayerLootInput,
  PlayerMoveInput,
  PlayerPickupInput,
  PlayerRecognizeInput,
  PlayerStealInput,
  PlayerStrikeInput,
  PlayerTalkInput,
  PlayerTeleportInput,
  PlayerUnequipInput,
  PlayerUseInput,
} from "./inputs";
import { applyPlayerPlanOnState, applyPlayerAction as submit } from "./plan";

/**
 * 每个动作一个入口：把服务层输入翻译成一条动作，再交给同一份计划落账。
 *
 * 这层薄是有意的——玩家入口没有计划与工具，只有「一个已经决定好的动作」；
 * 参数校验仍然复用模型工具的解析器（`parseCall` / `parseTeleport`），
 * 免得两个入口各写一份规则。
 */

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
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerMove(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerMoveInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "move", targetStageName: input.targetStageRef };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerTeleport(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerTeleportInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  // 玩家入口与模型工具共用同一份参数校验：`#编号` 在这里就该被拒。
  const action: ActorAction = parseTeleport({ targetStageName: input.targetStageRef });
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerWait(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "wait" };
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerSteal(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerStealInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "steal",
    targetActorHandle: input.targetActorRef,
    itemName: input.itemName,
  };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerInspect(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerInspectInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "inspect",
    targetActorHandle: input.targetActorRef,
  };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerLoot(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerLootInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "loot",
    targetActorHandle: input.targetActorRef,
    ...(input.itemNames === undefined ? {} : { itemNames: input.itemNames }),
  };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerGive(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerGiveInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "give",
    targetActorHandle: input.targetActorRef,
    itemName: input.itemName,
  };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerPickup(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerPickupInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = {
    kind: "pickup",
    targetAnchor: input.targetAnchor,
    itemName: input.itemName,
  };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerEquip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerEquipInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "equip", itemName: input.itemName, slot: input.slot };
  return submit(db, gameRef, actorRef, action, options);
}

export async function playerUnequip(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerUnequipInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const action: ActorAction = { kind: "unequip", slot: input.slot };
  return submit(db, gameRef, actorRef, action, options);
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
  return submit(db, gameRef, actorRef, action, options);
}

/** 玩家替自己控制的角色记下一个名字；与模型侧的名字更新走同一份计划。 */
export async function playerRecognizeIdentity(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerRecognizeInput,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const target = findActorByRef(state, input.targetActorRef);
  const plan: ActorPlan = {
    actions: [],
    identities: [{ handle: handleOf(target.signature.seq), name: parseSignatureName(input.name) }],
  };
  return applyPlayerPlanOnState(db, state, actor, plan, options);
}

/** 玩家替自己控制的角色回忆一条路线；结论只进自己的认知，不占行动名额。 */
export async function playerRecallRoute(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: RouteQuestion,
  options: ApplyActorPlanOptions = {},
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const resolution = resolveRouteQuestion(state, stageOfActor(state, actor.id), input);
  // 地名对不上也是一次回忆的结论：落成「无法寻路」的认知，而不是把整个回合判成失败。
  const plan: ActorPlan = resolution.ok
    ? { actions: [], routes: [resolution.query] }
    : { actions: [], routeFailures: [resolution.failure] };
  return applyPlayerPlanOnState(db, state, actor, plan, options);
}

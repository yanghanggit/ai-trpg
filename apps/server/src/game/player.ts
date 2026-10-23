import type { Database } from "../db/pool";
import type { CommunicationActionType } from "./actions";
import { findActor } from "./actors";
import { applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { getGameState } from "./service";
import type { ActorPlan, ActorTurnResult, InteractPurpose, InteractPurposeKind } from "./types";

export type PlayerCommunicationMode = CommunicationActionType;

export type PlayerCommunicationInput = {
  mode: PlayerCommunicationMode;
  message: string;
  targetActorName?: string;
  reason?: string;
};

export type PlayerAttackInput = {
  targetActorName: string;
  itemNames?: readonly string[];
};

export type PlayerMoveInput = {
  targetStageName: string;
};

export type PlayerInteractInput = {
  purpose: InteractPurposeKind;
  targetActorName?: string;
  targetStageName?: string;
  itemName?: string;
  itemNames?: readonly string[];
};

/** 玩家直接提交计划；只允许玩家接管的 actor。 */
async function applyPlayerPlan(
  db: Database,
  gameRef: string,
  actorRef: string,
  plan: ActorPlan,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  if (!(await isPlayerControlled(db, state.game.id, actor.id))) {
    throw new GameError("invalid_action", `actor 未被玩家接管: ${actor.name}`);
  }

  const ok = await applyActorPlan(db, state.game.id, actor.id, plan, [], true);
  if (!ok) {
    throw new GameError("invalid_action", "玩家行动被拒绝");
  }

  return {
    ok: true,
    plan,
    loopSuccess: true,
    state: await getGameState(db, state.game.id),
  };
}

/**
 * 玩家直接提交一次沟通行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerCommunicate(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerCommunicationInput,
): Promise<ActorTurnResult> {
  const plan: ActorPlan = {
    intents: [
      {
        kind: "communication",
        mind: input.reason?.trim() || "玩家直接提交",
        mode: input.mode,
        ...(input.targetActorName !== undefined ? { targetActorName: input.targetActorName } : {}),
        message: input.message,
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

/**
 * 玩家直接提交一次移动行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerMove(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerMoveInput,
): Promise<ActorTurnResult> {
  const plan: ActorPlan = {
    intents: [{ kind: "movement", mode: "move", targetStageName: input.targetStageName }],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

/** 按交互分支校验玩家输入并组装 purpose；参数要求与工具侧保持一致。 */
function playerInteractPurpose(input: PlayerInteractInput): InteractPurpose {
  const targetActorName = input.targetActorName?.trim() ?? "";
  const targetStageName = input.targetStageName?.trim() ?? "";
  const itemName = input.itemName?.trim() ?? "";

  switch (input.purpose) {
    case "damage":
      if (targetActorName.length === 0) {
        throw new GameError("invalid_action", "damage 分支需要 targetActorName");
      }
      return { kind: "damage", targetActorName };
    case "steal":
    case "give":
      if (targetActorName.length === 0 || itemName.length === 0) {
        throw new GameError(
          "invalid_action",
          `${input.purpose} 分支需要 targetActorName 与 itemName`,
        );
      }
      return { kind: input.purpose, targetActorName, itemName };
    case "pickup":
      if (itemName.length === 0) {
        throw new GameError("invalid_action", "pickup 分支需要 itemName");
      }
      return { kind: "pickup", itemName };
    case "use":
      if (itemName.length === 0 || targetActorName.length + targetStageName.length === 0) {
        throw new GameError(
          "invalid_action",
          "use 分支需要 itemName 与 targetActorName / targetStageName 之一",
        );
      }
      if (targetActorName.length > 0 && targetStageName.length > 0) {
        throw new GameError(
          "invalid_action",
          "use 分支需要 targetActorName 或 targetStageName 二选一",
        );
      }
      return {
        kind: "use",
        itemName,
        ...(targetActorName.length > 0 ? { targetActorName } : {}),
        ...(targetStageName.length > 0 ? { targetStageName } : {}),
      };
  }
}

/**
 * 玩家直接提交一次交互。
 *
 * 交互 = 目的 + 道具；不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerInteract(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerInteractInput,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  findActor(state, actorRef);
  const plan: ActorPlan = {
    intents: [
      {
        kind: "interact",
        itemNames: input.itemNames ?? [],
        purpose: playerInteractPurpose(input),
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

/**
 * 玩家直接提交一次攻击；它是 `damage` 分支的交互快捷入口。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerAttack(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerAttackInput,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  findActor(state, actorRef);
  const plan: ActorPlan = {
    intents: [
      {
        kind: "interact",
        itemNames: input.itemNames ?? [],
        purpose: { kind: "damage", targetActorName: input.targetActorName },
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

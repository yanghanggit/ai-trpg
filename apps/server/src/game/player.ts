import type { Database } from "../db/pool";
import type { CommunicationActionType } from "./actions";
import { findActor } from "./actors";
import { applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { getGameState } from "./service";
import type { ActorPlan, ActorTurnResult, Skill, SkillPurpose } from "./types";

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

export type PlayerSkillInput = {
  skillKey: string;
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

function playerSkillPurpose(skill: Skill, input: PlayerSkillInput): SkillPurpose {
  const targetActorName = input.targetActorName?.trim();
  const targetStageName = input.targetStageName?.trim();
  const itemName = input.itemName?.trim();

  if (skill.purposeKinds.includes("steal") && targetActorName && itemName) {
    return { kind: "steal", targetActorName, itemName };
  }
  if (skill.purposeKinds.includes("give") && targetActorName && itemName) {
    return { kind: "give", targetActorName, itemName };
  }
  if (skill.purposeKinds.includes("pickup") && itemName) {
    return { kind: "pickup", itemName };
  }
  if (skill.purposeKinds.includes("use") && itemName && (targetActorName || targetStageName)) {
    if (targetActorName && targetStageName) {
      throw new GameError(
        "invalid_action",
        "use 目的需要 targetActorName 或 targetStageName 二选一",
      );
    }
    return {
      kind: "use",
      itemName,
      ...(targetActorName ? { targetActorName } : {}),
      ...(targetStageName ? { targetStageName } : {}),
    };
  }
  if (skill.purposeKinds.includes("damage") && targetActorName) {
    return { kind: "damage", targetActorName };
  }
  throw new GameError("invalid_action", `技能 ${skill.name} 缺少匹配的目标或物品`);
}

/**
 * 玩家直接提交一次通用技能行动。
 *
 * 不调用 LLM；actor 必须处于玩家控制下，否则拒绝。
 */
export async function playerSkill(
  db: Database,
  gameRef: string,
  actorRef: string,
  input: PlayerSkillInput,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);
  const skill = actor.skills.find((candidate) => candidate.key === input.skillKey);
  if (!skill) {
    throw new GameError("invalid_action", `actor 未掌握技能: ${input.skillKey}`);
  }
  const plan: ActorPlan = {
    intents: [
      {
        kind: "skill",
        skill,
        itemNames: input.itemNames ?? [],
        purpose: playerSkillPurpose(skill, input),
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

/**
 * 玩家直接提交一次攻击行动。
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
  const actor = findActor(state, actorRef);
  const skill = actor.skills.find((candidate) => candidate.key === "attack");
  if (!skill) {
    throw new GameError("invalid_action", `actor 未掌握技能: attack`);
  }
  const plan: ActorPlan = {
    intents: [
      {
        kind: "skill",
        skill,
        itemNames: input.itemNames ?? [],
        purpose: { kind: "damage", targetActorName: input.targetActorName },
      },
    ],
  };
  return applyPlayerPlan(db, gameRef, actorRef, plan);
}

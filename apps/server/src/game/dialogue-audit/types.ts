import type {
  DialogueActionKind,
  DialogueCategory,
  DialogueFailureKind,
} from "../persistence/dialogue-blocks";
import type { WorldState } from "../types";

/**
 * 审核的形状：问什么、答什么、调用方在审核之后拿到什么。
 *
 * 审核只管「这句话能不能进入游戏」，不判断角色是否知道它——认知由名字与记忆负责。
 */

/** 审核判断的是“这句话能不能进入游戏”，不是角色是否知道它。 */
export type DialogueAuditRequest = {
  actionKind: DialogueActionKind;
  message: string;
  actorName: string;
  stageName: string;
  world: WorldState;
};

export type DialogueVerdict = {
  allowed: boolean;
  categories: DialogueCategory[];
  reason: string;
};

export type DialogueJudge = (input: DialogueAuditRequest) => Promise<DialogueVerdict>;

export type DialogueAuditResult = {
  allowed: boolean;
  reason: string;
  categories: DialogueCategory[];
  failureKind?: DialogueFailureKind;
  auditId?: string;
  latencyMs: number;
  contentHash: string;
  model: string;
};

export type DialogueContext = {
  gameId: string;
  playerId: string;
  actorId: string;
  targetActorId?: string | null;
  actionKind: DialogueActionKind;
  message: string;
  actorName: string;
  stageName: string;
  world: WorldState;
};

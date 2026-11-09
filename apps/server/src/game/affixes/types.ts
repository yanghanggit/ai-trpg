import type { AffixTrigger } from "./model";
import type { StaticSettlement } from "./static";

export type AffixOperation =
  | {
      kind: "damage";
      affixName: string;
      targetActorHandle: string;
      amount: number;
      reason: string;
    }
  | {
      kind: "witness";
      affixName: string;
      targetActorHandle?: string;
      targetAnchor?: string;
      template: string;
      visibility: "stage" | "target";
    };

/** 静态阶段完成后交给 agent 阶段的输入。 */
export type AffixRequest = {
  actorId: string;
  itemId: string;
  trigger: AffixTrigger;
  targetActorId?: string;
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  /** 静态命中落账后的真实结果；没有命中时为 0 / false。 */
  staticOutcome?: StaticOutcome;
};

/** 静态命中落账后的实际结果；没有命中时为 0 / false。 */
export type StaticOutcome = {
  /** 实际扣除的 HP，按目标剩余生命截断。 */
  dealtDamage: number;
  /** 本次静态命中是否让目标 HP 归零。 */
  targetDied: boolean;
};

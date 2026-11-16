import type { SettlementHitResult, SettlementOutcome } from "../../gameplay/settlement";
import type { AffixTrigger } from "../../kernel/affixes";

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
  /** 这次动作作用到的角色；单体动作就是一项，横扫是名单里的全部。 */
  targetActorIds?: readonly string[];
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
  settlement?: SettlementOutcome;
  /** 每个目标的静态实际结果；没有命中时为空。 */
  outcomes?: readonly SettlementHitResult[];
};

import type { AffixTrigger } from "../../kernel/affixes";
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
  /** 这次动作作用到的角色；单体动作就是一项，横扫是名单里的全部。 */
  targetActorIds?: readonly string[];
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  /** 每个目标的静态实际结果；没有命中时为空。 */
  staticOutcomes?: readonly StaticOutcome[];
};

/** 一个目标的静态命中结果；按角色对齐，不靠顺序。 */
export type StaticOutcome = {
  /** 这条结果属于哪个角色。 */
  actorId: string;
  /** 实际扣除的 HP，按目标剩余生命截断。 */
  dealtDamage: number;
  /** 本次静态命中是否让目标 HP 归零。 */
  targetDied: boolean;
};

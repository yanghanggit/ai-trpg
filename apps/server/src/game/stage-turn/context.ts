import { adjacentStageNames, sealedStageNames } from "../actors";
import type { GameStateSlice, StageActionKind, StageState } from "../types";

/** 仲裁动作的固定顺序：工具列表按它排，内容里声明的先后不影响模型看到的顺序。 */
export const STAGE_ACTION_KINDS = [
  "submit_environment",
  "notify_world",
  "open_passage",
  "add_anchor",
  "remove_anchor",
  "update_anchor",
] as const satisfies readonly StageActionKind[];

/**
 * 一个 stage 回合里「本场景此刻能做什么、看得见什么」的派生结果。
 *
 * 提示词与工具表都从这里取，免得「提示词里说能开通道、工具列表里却没有」这种错位。
 */
export type StageTurnContext = {
  stage: StageState;
  /** 本场景的仲裁能力清单（内容层声明）。 */
  allowed: readonly StageActionKind[];
  /** 可去的相邻场景名。 */
  moves: string[];
  /** 未开启通道对面的场景名。 */
  sealed: string[];
  anchorLabels: string[];
  actorNames: string[];
};

export function stageTurnContext(state: GameStateSlice, stage: StageState): StageTurnContext {
  return {
    stage,
    allowed: stage.actions,
    moves: adjacentStageNames(state, stage.id),
    sealed: sealedStageNames(state, stage.id),
    anchorLabels: stage.anchors.map((anchor) => anchor.label),
    actorNames: stage.actors.map((actor) => actor.name),
  };
}

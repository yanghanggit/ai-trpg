import { MAX_WORLD_ACTIONS_PER_TURN } from "../constants";
import { GameError } from "../errors";
import type { WorldAction, WorldPlan } from "../types";

/**
 * world 本轮计划的本子：写进去就刷新快照。
 *
 * 与 stage 同一条约定：模型忘记提交或轮次用尽时，已暂存的动作照样落账。
 * 与 actor 不同的是，空计划是合法的 no-op——「这一轮没有世界级变更」是常见结论。
 */
export type WorldPlanSession = {
  add(action: WorldAction): void;
  submit(): void;
  readonly plan: WorldPlan | null;
};

export function createWorldPlanSession(): WorldPlanSession {
  const actions: WorldAction[] = [];
  let plan: WorldPlan | null = null;
  let confirmed = false;

  const snapshot = (): WorldPlan => {
    plan = { actions: actions.map((action) => ({ ...action })) };
    return plan;
  };

  return {
    add: (action) => {
      if (confirmed) {
        throw new GameError("invalid_action", "计划已提交");
      }
      if (actions.length >= MAX_WORLD_ACTIONS_PER_TURN) {
        throw new GameError("invalid_action", `本轮最多 ${MAX_WORLD_ACTIONS_PER_TURN} 个世界动作`);
      }
      actions.push(action);
      snapshot();
    },
    submit: () => {
      confirmed = true;
      snapshot();
    },
    get plan() {
      return plan;
    },
  };
}

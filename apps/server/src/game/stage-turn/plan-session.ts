import { GameError } from "../errors";
import { MAX_STAGE_ANCHOR_WRITES_PER_TURN, MAX_STAGE_NOTIFICATIONS_PER_TURN } from "../limits";
import type { StageAction, StagePlan } from "../types";
import { type AnchorWrite, isAnchorWrite } from "./anchors";

/**
 * stage 本轮计划的本子：写进去就算提交。
 *
 * 与 actor 的计划不同，仲裁没有「名额」概念——一次仲裁可以同时改 environment、
 * 开通道、发通知，所以每次写入都直接成为计划；模型忘记调 submit_stage_plan 时，
 * 已写下的裁决照样生效（曾经会整轮丢掉的正是这一种）。
 *
 * 各类动作的条数上限在这里把关：超出就当场拒绝，让模型在同一个回合里换个写法，
 * 而不是等落账时才被打回。
 */
export type StagePlanSession = {
  /** environment 是快照：同一轮重复提交后一次覆盖前一次。 */
  setEnvironment(environment: string): void;
  addNotification(notification: string): void;
  addPassage(targetStageName: string): void;
  addAnchor(action: AnchorWrite): void;
  submit(): void;
  /** 本轮要落账的仲裁计划；一次都没写过时是 `null`（= 回合没走完）。 */
  readonly plan: StagePlan | null;
};

export function createStagePlanSession(): StagePlanSession {
  const actions: StageAction[] = [];
  let plan: StagePlan | null = null;

  const snapshot = (): StagePlan => {
    plan = { actions: actions.map((action) => ({ ...action })) };
    return plan;
  };

  const count = (kind: StageAction["kind"]): number =>
    actions.filter((action) => action.kind === kind).length;

  return {
    setEnvironment: (environment) => {
      const index = actions.findIndex((action) => action.kind === "submit_environment");
      if (index >= 0) {
        actions[index] = { kind: "submit_environment", environment };
      } else {
        actions.push({ kind: "submit_environment", environment });
      }
      snapshot();
    },
    addNotification: (notification) => {
      if (count("notify_world") >= MAX_STAGE_NOTIFICATIONS_PER_TURN) {
        throw new GameError(
          "invalid_action",
          `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
        );
      }
      actions.push({ kind: "notify_world", notification });
      snapshot();
    },
    addPassage: (targetStageName) => {
      if (count("open_passage") >= 1) {
        throw new GameError("invalid_action", "本轮最多打开一条通道");
      }
      actions.push({ kind: "open_passage", targetStageName });
      snapshot();
    },
    addAnchor: (action) => {
      if (actions.filter(isAnchorWrite).length >= MAX_STAGE_ANCHOR_WRITES_PER_TURN) {
        throw new GameError(
          "invalid_action",
          `本轮最多调整 ${MAX_STAGE_ANCHOR_WRITES_PER_TURN} 个锚点`,
        );
      }
      actions.push(action);
      snapshot();
    },
    submit: () => {
      snapshot();
    },
    get plan() {
      return plan;
    },
  };
}

import { GameError } from "../errors";
import { MAX_ACTIONS_PER_TURN } from "../limits";
import type { ActorAction, ActorPlan, IdentityBinding, RouteFailure, RouteQuery } from "../types";

/**
 * 本轮计划的本子：动作、称呼、路线回忆先暂存在这里，提交才成为计划。
 *
 * 单独成模块是因为它有三条容易写错、又和 LLM 无关的规矩：
 * 每回合行动条数上限、提交后再写要拒绝、模型忘记提交时不能把已暂存的动作丢掉。
 * 第三条曾经真的丢过（轮次用尽后计划为空），现在由「每次写入都刷新快照」保证。
 */
export type TurnPlanSession = {
  /** 暂存一个行动；超过每回合上限直接拒绝。 */
  addAction(action: ActorAction): void;
  /** 记下一个称呼；同一个编号重复记时覆盖前一次，返回是新增还是更新。 */
  addIdentity(binding: IdentityBinding): "added" | "updated";
  readonly identities: readonly IdentityBinding[];
  /** 记下一条路线问题；同一条问题只记一次，返回是否真的记下。 */
  noteRoute(query: RouteQuery): boolean;
  noteRouteFailure(failure: RouteFailure): boolean;
  /** 提交本轮计划；空计划与重复提交都直接拒绝。 */
  submit(): void;
  readonly submitted: boolean;
  /**
   * 本轮要落账的计划：提交过就是提交的那一份，否则是最后一次写入后的快照。
   * 从没写过任何东西时是 `null`。
   */
  readonly plan: ActorPlan | null;
};

export function createPlanSession(): TurnPlanSession {
  const actions: ActorAction[] = [];
  const identities: IdentityBinding[] = [];
  const routes: RouteQuery[] = [];
  const routeFailures: RouteFailure[] = [];
  let submitted: ActorPlan | null = null;
  let snapshot: ActorPlan | null = null;

  const freeze = (): ActorPlan => {
    const plan: ActorPlan = { actions: actions.map((action) => ({ ...action })) };
    if (identities.length > 0) {
      plan.identities = identities.map((item) => ({ ...item }));
    }
    if (routes.length > 0) {
      plan.routes = routes.map((item) => ({ ...item }));
    }
    if (routeFailures.length > 0) {
      plan.routeFailures = routeFailures.map((item) => ({ ...item }));
    }
    snapshot = plan;
    return plan;
  };

  const ensureOpen = (): void => {
    if (submitted) {
      throw new GameError("invalid_action", "计划已提交");
    }
  };

  return {
    addAction: (action) => {
      ensureOpen();
      if (actions.length >= MAX_ACTIONS_PER_TURN) {
        throw new GameError(
          "invalid_action",
          `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动；需要连着做多个动作时，请分几个回合`,
        );
      }
      actions.push(action);
      freeze();
    },
    addIdentity: (binding) => {
      ensureOpen();
      const known = identities.find((existing) => existing.handle === binding.handle);
      if (known) {
        known.name = binding.name;
        freeze();
        return "updated";
      }
      identities.push({ ...binding });
      freeze();
      return "added";
    },
    get identities() {
      return identities;
    },
    noteRoute: (query) => {
      ensureOpen();
      const duplicate = routes.some(
        (item) => item.fromStageId === query.fromStageId && item.toStageId === query.toStageId,
      );
      if (duplicate) {
        return false;
      }
      routes.push({ ...query });
      freeze();
      return true;
    },
    noteRouteFailure: (failure) => {
      ensureOpen();
      const duplicate = routeFailures.some(
        (item) =>
          item.toStageRef === failure.toStageRef &&
          item.fromStageId === failure.fromStageId &&
          item.fromStageRef === failure.fromStageRef,
      );
      if (duplicate) {
        return false;
      }
      routeFailures.push({ ...failure });
      freeze();
      return true;
    },
    submit: () => {
      ensureOpen();
      if (
        actions.length === 0 &&
        identities.length === 0 &&
        routes.length === 0 &&
        routeFailures.length === 0
      ) {
        throw new GameError("invalid_action", "计划中没有行动");
      }
      submitted = freeze();
    },
    get submitted() {
      return submitted !== null;
    },
    get plan() {
      return submitted ?? snapshot;
    },
  };
}

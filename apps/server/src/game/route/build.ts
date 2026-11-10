import type { ActorWithStage } from "../actor-state";
import { visitedStageIds } from "../actor-state";
import { resolveStageName } from "../stage-state";
import type { ConnectionState, GameStateSlice } from "../types";
import type { RouteNode, RouteQuestion, RouteResolution, RouteWorld } from "./types";

/**
 * 问路的两端准备：把状态收成一张窄图，把模型给的引用解析成端点 id。
 *
 * 都只做输入侧的事——不寻路、不渲染、不写记忆。走不通与解析不到都返回结果对象，
 * 让上层把它们写成同一种「这次的结论」。
 */

/**
 * 把「场景、边、去过哪些场景」收成一次回忆的窄世界。
 *
 * 两个入口共用这一份规则：实时工具从 `GameStateSlice` 来，结算事务从窄读来。
 * `visited` 恒含当前场景——站在这里就能看见它，即使到访表还没记过。
 */
export function routeWorldOf(input: {
  stages: readonly { id: string; seq: number; name: string; ordinal: number }[];
  connections: readonly Pick<ConnectionState, "fromStageId" | "toStageId" | "passage">[];
  visitedStageIds: Iterable<string>;
  currentStageId: string;
}): RouteWorld {
  const visited = new Set(input.visitedStageIds);
  visited.add(input.currentStageId);
  const stages: RouteNode[] = input.stages.map(({ id, seq, name, ordinal }) => ({
    id,
    seq,
    name,
    ordinal,
  }));
  return { stages, connections: input.connections, visited };
}

export function routeWorldFromState(state: GameStateSlice, current: ActorWithStage): RouteWorld {
  return routeWorldOf({
    stages: state.world.stages,
    connections: state.world.connections,
    visitedStageIds: visitedStageIds(state, current.actor.id),
    currentStageId: current.stage.id,
  });
}

/**
 * 把引用解析成端点 id。
 *
 * 只做输入判定：名字必须是能解析到场景的真名（`#序号` 不是名字）。**不查知识账**——
 * 问路是推理，不是位移；端点是不是自己去过，只影响链上写名字还是写 `#序号`。
 *
 * 解析不到时给出 `RouteFailure` 而不是抛错：这次回忆的结论就是「无法寻路」，
 * 和走不通一样要进自己的记忆。
 */
export function resolveRouteQuestion(
  state: GameStateSlice,
  current: ActorWithStage,
  question: RouteQuestion,
): RouteResolution {
  const to = resolveStageName(state, question.toStageRef);
  const fromRef = question.fromStageRef;
  const from =
    fromRef === undefined
      ? { ok: true as const, stage: current.stage }
      : resolveStageName(state, fromRef);
  if (!to.ok) {
    return {
      ok: false,
      failure: {
        ...(from.ok ? { fromStageId: from.stage.id } : { fromStageRef: fromRef }),
        toStageRef: question.toStageRef,
        reason: to.reason,
      },
    };
  }
  if (!from.ok) {
    return {
      ok: false,
      failure: { fromStageRef: fromRef, toStageRef: question.toStageRef, reason: from.reason },
    };
  }
  return { ok: true, query: { fromStageId: from.stage.id, toStageId: to.stage.id } };
}

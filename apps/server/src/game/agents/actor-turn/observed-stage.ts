/**
 * 这一轮里，这个 actor 看到的场景面：environment 文本、出口怎么叫、记得封着的门。
 *
 * 名字只来自到访（`stage_visits`），所以这里的写法与 `client-view/actor.ts` 的结构化视图是
 * 同一条规则的两个出口：查询共用 `actor-state` 的到访派生，渲染各管各的。
 */

import {
  type ActorWithStage,
  sealedVisitedStagesForActor,
  visitedStageIds,
} from "../../actor-state";
import { addressLookupFor, handleOf, sanitizeActorFacingText } from "../../kernel/addressing";
import type { GameStateSlice } from "../../kernel/types";
import { adjacentStages } from "../../stage-state";

/**
 * 把 environment 渲染成某个 actor 能读的版本。
 *
 * 回合初始输入与 `look_stage` 共用：environment 是拉取入口，读取时按观察者再脱敏
 * 一次，不能只依赖写入守卫（建局数据与历史数据都可能绕过守卫）。
 */
export function renderStageEnvironmentForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string {
  const stage = current.stage;
  const address = addressLookupFor(state, current.actor, stage);
  const otherActorNames = state.world.stages
    .flatMap((candidate) => candidate.actors)
    .filter((actor) => !stage.actors.some((present) => present.id === actor.id))
    .map((actor) => actor.name);
  return sanitizeActorFacingText(stage.environment, stage.actors, address, otherActorNames);
}

/**
 * actor 视角的可去方向：去过的写名字，没走过的只给实体编号。
 *
 * 名字只来自到访（`stage_visits`）：没走过的场景就是 `#序号`，即使离开场简报里
 * 或别人嘴里听过这个名字——文本不构成结构化的地名知识。
 */
export function adjacentStageRefsForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string[] {
  const visited = visitedStageIds(state, current.actor.id);
  return adjacentStages(state, current.stage.id).map((stage) =>
    visited.has(stage.id) ? stage.name : handleOf(stage.seq),
  );
}

/** 记得封着的出口：只列名字，走不通这件事由调用方写在提示词里。 */
export function sealedVisitedStageRefsForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): string[] {
  return sealedVisitedStagesForActor(state, current).map((stage) => stage.name);
}

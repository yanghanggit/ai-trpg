import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./edges";
import type { GameStateSlice, StageState } from "./types";

/**
 * 场景的邻接关系：从某个场景出发，哪些能走、哪些封着。
 *
 * 图本身属于 `edges.ts`（连接行的索引）；这里只把索引套到已装载的状态上，
 * 让提示词、视图和移动共用同一份「隔壁是谁」的判断。两张表都随通道开合变化，
 * 调用方总是现算，不要缓存。
 */

function stagesById(state: GameStateSlice): Map<string, StageState> {
  return new Map(state.world.stages.map((stage) => [stage.id, stage]));
}

/** 只走已通行的边。 */
export function adjacentStages(state: GameStateSlice, stageId: string): StageState[] {
  const byId = stagesById(state);
  const edges = buildEdgeIndex(state.world.connections);
  return openNeighborIds(edges, stageId)
    .map((id) => byId.get(id))
    .filter((stage): stage is StageState => stage !== undefined);
}

/** 返回从指定场景可直接到达的场景名。 */
export function adjacentStageNames(state: GameStateSlice, stageId: string): string[] {
  return adjacentStages(state, stageId).map((stage) => stage.name);
}

/** 剧情上相连、但当前不可通过的场景；供 stage 小 GM 判断能否 open_passage。 */
export function sealedStages(state: GameStateSlice, stageId: string): StageState[] {
  const byId = stagesById(state);
  const edges = buildEdgeIndex(state.world.connections);
  return sealedNeighborIds(edges, stageId).flatMap((id) => {
    const stage = byId.get(id);
    return stage ? [stage] : [];
  });
}

export function sealedStageNames(state: GameStateSlice, stageId: string): string[] {
  return sealedStages(state, stageId).map((stage) => stage.name);
}

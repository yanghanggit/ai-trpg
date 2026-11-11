import type { GameStateSlice, PassageState, StageState } from "../kernel/types";
import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./graph";

/**
 * 舞台的邻接关系：从某个舞台出发，哪些能走、哪些封着。
 *
 * 图本身属于 `graph.ts`（边、索引与遍历）；这里只把索引套到已装载的状态上，
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

/** 返回从指定舞台可直接到达的舞台名。 */
export function adjacentStageNames(state: GameStateSlice, stageId: string): string[] {
  return adjacentStages(state, stageId).map((stage) => stage.name);
}

/**
 * 所有出边，连通行状态一起给：客户端要区分「能走」与「封着」，所以不能用
 * `adjacentStages` 过滤掉一半。图本身仍在 `graph.ts`，这里只做「边 → 舞台」的连接。
 */
export function outgoingStages(
  state: GameStateSlice,
  stageId: string,
): { stage: StageState; passage: PassageState }[] {
  const byId = stagesById(state);
  return buildEdgeIndex(state.world.connections)
    .outgoing(stageId)
    .flatMap((edge) => {
      const stage = byId.get(edge.toStageId);
      return stage ? [{ stage, passage: edge.passage }] : [];
    });
}

/** 剧情上相连、但当前不可通过的舞台；供舞台判断能否 open_passage。 */
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

/**
 * 场景的状态层：认出一个场景、看清它们之间怎么连、从这里能去哪。
 *
 * 只读已装载的状态，不碰数据库（行级读写在 `persistence/stages.ts`）。到访单独在
 * `actor-state/visit.ts`：那是 actor 的认知账本，不是地形。
 */

export { describeStageAnchors, describeStageAnchorsSection, stageItemNames } from "./describe";
export {
  assertEdgeShape,
  buildEdgeIndex,
  distanceOf,
  type EdgeIndex,
  type GraphSearch,
  openNeighborIds,
  pathTo,
  reverseEdges,
  type StageEdge,
  sealedNeighborIds,
  search,
} from "./graph";
export { findStage, findStageByName, resolveStageName, type StageNameResolution } from "./locate";
export {
  adjacentStageNames,
  adjacentStages,
  outgoingStages,
  sealedStageNames,
  sealedStages,
} from "./neighbors";

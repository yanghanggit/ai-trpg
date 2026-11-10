/**
 * actor 的状态层：认出一个人，记住他认得哪些地方。
 *
 * 只读已装载的状态，不碰数据库（行级读写在 `persistence/actors.ts`）。定义侧的 key 引用
 * 与建局无关，这里只服务运行时。
 */

export {
  type ActorWithStage,
  allActors,
  findActorByName,
  findActorByRef,
  findActorBySignatureSeq,
  otherActorsInStage,
  stageOfActor,
} from "./locate";
export {
  sealedVisitedStagesForActor,
  visitedStageIds,
  visitedStagesForActor,
  visitedTeleportTargetsFor,
} from "./visit";

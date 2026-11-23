import type { Database } from "../../db/pool";
import {
  allActors,
  findActorByName,
  perceivedActorsFor,
  sealedVisitedStagesForActor,
  visitedStagesForActor,
} from "../actor-state";
import { getGameStateSlice } from "../game-state";
import { addressLookupFor, handleOf, nameOf } from "../kernel/addressing";
import type { GameStateSlice } from "../kernel/types";
import { getMemoryState } from "../memory";
import { adjacentStages } from "../stage-state";
import { actorLog } from "./log";
import { gameOf, viewerAnchors } from "./project";
import type { ActorLogView, ActorView, ViewerAddress, ViewerName } from "./types";

/**
 * 一个 actor 看到的世界面：他自己的舞台、名单、出口、记忆日志。
 *
 * 公共事件流的文本在写入时就已经带名字，无法可靠地事后脱敏；所以观看者视角直接
 * 读该 actor 的记忆——它本来就是为了这个观察者渲染的。这里只负责把记忆、舞台与
 * 引用整理成稳定形状，不做新的过滤规则。
 */
export async function getActorView(
  db: Database,
  gameRef: string,
  actorRef: string,
  /** 已经装配好的状态；调用方刚读过就传进来，省一次水合。 */
  loaded?: GameStateSlice,
): Promise<ActorView> {
  const state = loaded ?? (await getGameStateSlice(db, gameRef));
  const { actor, stage } = findActorByName(state, actorRef);
  const address = addressLookupFor(state, actor, stage);

  const actors: ViewerAddress[] = perceivedActorsFor(stage, actor.id).map((candidate) => {
    const entry = address(candidate.id);
    return {
      actorId: candidate.id,
      signatureId: candidate.signature.id,
      token: entry.token,
      name: nameOf(entry),
      appearance: entry.appearance,
      self: candidate.id === actor.id,
      alive: candidate.hp > 0,
    };
  });

  const visitedStages = visitedStagesForActor(state, actor.id).map((candidate) => ({
    stageId: candidate.id,
    name: candidate.name,
  }));

  /** 认得的人：身份锚在签名上，所以拿签名 id 反查当前编号与形态。 */
  const names: ViewerName[] = state.signatureNames
    .filter((row) => row.observerActorId === actor.id)
    .flatMap((row) => {
      const subject = allActors(state).find(
        (candidate) => candidate.actor.signature.id === row.signatureId,
      );
      if (subject === undefined) {
        // 换成别的签名后，旧称呼不跟过去；对不上签名的行没有可展示的形态。
        return [];
      }
      const learnedStage = state.world.stages.find((stage) => stage.id === row.learnedStageId);
      return [
        {
          name: row.name,
          token: handleOf(subject.actor.signature.seq),
          form: subject.actor.signature.form,
          source: row.source,
          learnedAt: learnedStage?.name ?? null,
        },
      ];
    });

  return {
    game: gameOf(state),
    viewer: {
      actorId: actor.id,
      signatureId: actor.signature.id,
      name: actor.name,
      appearance: actor.appearance.text,
      concealed: actor.concealed,
    },
    stage: {
      id: stage.id,
      name: stage.name,
      environment: stage.environment,
      anchors: viewerAnchors(stage),
      actors,
      exits: adjacentStages(state, stage.id).map((exit) => ({
        stageId: exit.id,
        name: exit.name,
        ref: handleOf(exit.seq),
      })),
      sealedExits: sealedVisitedStagesForActor(state, { actor, stage }).map((sealed) => ({
        stageId: sealed.id,
        name: sealed.name,
      })),
    },
    names,
    visitedStages,
  };
}

/** 一个角色感知到的事，按发生顺序；数据来自他自己的记忆。 */
export async function getActorLog(
  db: Database,
  gameRef: string,
  actorRef: string,
  /** 已经装配好的状态；调用方刚读过就传进来，省一次水合。 */
  loaded?: GameStateSlice,
): Promise<ActorLogView> {
  const state = loaded ?? (await getGameStateSlice(db, gameRef));
  const { actor } = findActorByName(state, actorRef);
  const memory = await getMemoryState(db, state.game.id, "actor", actor.id);
  return {
    owner: { actorId: actor.id, name: actor.name },
    entries: actorLog(memory?.messages ?? []),
  };
}

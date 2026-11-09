import type { Database } from "../../db/pool";
import { findActorByName } from "../actor-state";
import { addressLookupFor, refOf } from "../addressing";
import { getMemoryState } from "../memory";
import { adjacentStages } from "../neighbors";
import { sealedVisitedStagesForActor } from "../plan";
import { getGameStateSlice } from "../read/game-state";
import { handleOf } from "../reference";
import { visitedStagesForActor, visitedTeleportTargetsFor } from "../visit-state";
import { actorLog } from "./log";
import { gameOf, viewerAnchors } from "./project";
import type { ActorView, ViewerAddress } from "./types";

/**
 * 一个 actor 看到的世界面：他自己的场景、名单、出口、记忆日志。
 *
 * 公共事件流的文本在写入时就已经带名字，无法可靠地事后脱敏；所以观看者视角直接
 * 读该 actor 的记忆——它本来就是为了这个观察者渲染的。这里只负责把记忆、场景与
 * 引用整理成稳定形状，不做新的过滤规则。
 */
export async function getActorView(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorView> {
  const state = await getGameStateSlice(db, gameRef);
  const { actor, stage } = findActorByName(state, actorRef);
  const memory = await getMemoryState(db, state.game.id, "actor", actor.id);
  const address = addressLookupFor(state, actor, stage);

  const actors: ViewerAddress[] = stage.actors.map((candidate) => {
    const entry = address(candidate.id);
    return {
      actorId: candidate.id,
      signatureId: candidate.signature.id,
      token: entry.token,
      label: refOf(entry),
      self: candidate.id === actor.id,
      alive: candidate.hp > 0,
    };
  });

  const visitedStages = visitedStagesForActor(state, actor.id).map((candidate) => ({
    stageId: candidate.id,
    name: candidate.name,
  }));
  const teleportTargets = visitedTeleportTargetsFor(state, actor, stage).map((candidate) => ({
    stageId: candidate.id,
    name: candidate.name,
  }));

  return {
    game: gameOf(state),
    viewer: {
      actorId: actor.id,
      signatureId: actor.signature.id,
      name: actor.name,
      appearance: actor.appearance.text,
    },
    scene: {
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
    signatureNames: state.signatureNames.filter((row) => row.observerActorId === actor.id),
    log: actorLog(memory?.messages ?? []),
    visitedStages,
    teleportTargets,
  };
}

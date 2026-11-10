import type { Database } from "../../db/pool";
import { isAlive } from "../lookup";
import { getMemoryState } from "../memory";
import { getGameStateSlice } from "../read/game-state";
import { findStage, outgoingStages } from "../stage-state";
import { stageLog } from "./log";
import { gameOf, viewerAnchors } from "./project";
import type { StageView } from "./types";

/**
 * 一个场景小 GM 看到的世界面：本场景、在场角色、全部出边（含封着的）、记忆日志。
 *
 * 与 actor 视图的区别在出口：小 GM 要裁决 open_passage，所以它需要看见封着的边，
 * 而不像演员那样只看见能走的。日志同样按 stage 自己的白名单挑。
 */
export async function getStageView(
  db: Database,
  gameRef: string,
  stageRef: string,
): Promise<StageView> {
  const state = await getGameStateSlice(db, gameRef);
  const stage = findStage(state, stageRef);
  const memory = await getMemoryState(db, state.game.id, "stage", stage.id);

  return {
    game: gameOf(state),
    viewer: { stageId: stage.id, name: stage.name },
    scene: {
      id: stage.id,
      name: stage.name,
      environment: stage.environment,
      anchors: viewerAnchors(stage),
      actors: stage.actors.map((actor) => ({
        actorId: actor.id,
        name: actor.name,
        appearance: actor.appearance.text,
        alive: isAlive(actor),
      })),
      exits: outgoingStages(state, stage.id).map(({ stage: target, passage }) => ({
        stageId: target.id,
        name: target.name,
        passage,
      })),
    },
    log: stageLog(memory?.messages ?? []),
  };
}

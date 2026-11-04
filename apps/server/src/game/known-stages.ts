import type { Database } from "../db/pool";
import { findActorByRef, findStage } from "./actors";
import { bumpGameVersion } from "./apply/messages";
import { GameError } from "./errors";
import { lockGameRow } from "./persistence/games";
import { recordKnownStage } from "./persistence/known-stages";
import { getGameStateSlice } from "./read/game-state";
import { knownStageIds } from "./teleport";

export type LearnedStage = {
  actorId: string;
  actorName: string;
  stageId: string;
  stageName: string;
  /** 之前就知道（到访或已记录）时为 false，此时不写库也不 bump 版本。 */
  created: boolean;
  /** 写入后的游戏版本号；没有写入时是原版本。 */
  version: number;
};

/**
 * 让 actor 知道一个场景的真名；不占回合、不产生公共事件。
 *
 * 这里自带事务与版本推进，是「不占回合」的独立入口（开发期 CLI 用）。
 * 将来的鸟瞰 / 望远镜发生在回合里，应当在回合事务中直接调用 `recordKnownStage`，
 * 与那次状态写入同生共死，不要嵌套调用这个函数。
 * 当前场景名始终可见，不需要记录，所以直接拒绝，避免知识表里堆无意义行。
 */
export async function learnStageName(
  db: Database,
  gameRef: string,
  actorRef: string,
  stageRef: string,
): Promise<LearnedStage> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const stage = findStage(state, stageRef);
  const current = state.world.stages.find((candidate) =>
    candidate.actors.some((entry) => entry.id === actor.id),
  );
  if (current?.id === stage.id) {
    throw new GameError("invalid_action", `当前场景名始终可见，不需要记录: ${stage.name}`);
  }

  const created = !knownStageIds(state, actor.id).has(stage.id);
  let version = state.game.version;
  if (created) {
    const now = new Date();
    version += 1;
    await db.transaction(async (tx) => {
      const locked = await lockGameRow(tx, state.game.id);
      if (!locked) {
        throw new GameError("not_found", `游戏不存在: ${gameRef}`);
      }
      if (locked.status !== "active") {
        throw new GameError("invalid_action", `游戏已结束，不能再授予场景知识: ${gameRef}`);
      }
      await recordKnownStage(
        tx,
        {
          gameId: state.game.id,
          actorId: actor.id,
          stageId: stage.id,
          source: "runtime",
          learnedStageId: current?.id ?? null,
        },
        now,
      );
      await bumpGameVersion(tx, state.game.id, now);
    });
  }

  return {
    actorId: actor.id,
    actorName: actor.name,
    stageId: stage.id,
    stageName: stage.name,
    created,
    version,
  };
}

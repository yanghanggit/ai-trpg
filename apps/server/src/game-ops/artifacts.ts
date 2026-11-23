/**
 * 调试产物的落盘入口：快照与故事总结。
 *
 * 这两件事都写文件，所以只服务开发期入口（`agent:game` / `agent:api`）；
 * 服务端路由调用它们时写的是服务端进程的工作目录，与仓库根的 `logs/` 对齐。
 */

import type { Database } from "../db/pool";
import { snapshotGame } from "../debug/snapshot-game";
import { dumpStory } from "../debug/story-dump";
import { runStory } from "../game";
import type { LlmServices } from "./services";

export async function snapshotOp(
  db: Database,
  gameRef: string,
  options: { root?: string } = {},
): Promise<{
  path: string;
  manifest: Record<string, unknown>;
  game: Record<string, unknown>;
}> {
  const result = await snapshotGame(db, gameRef, {
    ...(options.root === undefined ? {} : { root: options.root }),
    action: "snapshot",
  });
  return {
    path: result.snapshot.path,
    manifest: result.snapshot.manifest,
    game: result.state.game,
  };
}

export async function storyOp(
  db: Database,
  gameRef: string,
  services: LlmServices,
): Promise<Record<string, unknown> & { path: string }> {
  const result = await runStory(db, gameRef, { service: services.service });
  const path = await dumpStory({
    gameName: result.gameName,
    gameSlug: result.gameSlug,
    gameStatus: result.gameStatus,
    contentVersion: result.contentVersion,
    version: result.version,
    story: result.story,
    rounds: result.rounds,
    memoriesRead: result.memoriesRead,
    eventsRead: result.eventsRead,
  });
  return { ...result, path };
}

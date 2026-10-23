import type { Database } from "../db/pool";
import {
  formatSnapshotId,
  type JsonValue,
  type SessionEvent,
  saveSnapshot,
} from "../debug/snapshot";
import { getGameMemories } from "./memory";
import { getGameState } from "./service";

function memoryFileName(name: string): string {
  return name.replace(/[/\\\0:*?"<>|]/g, "_").replace(/^\.+$/, "_") || "actor";
}

export type GameSnapshotOptions = {
  root?: string;
  action?: string;
  now?: Date;
};

/** 把当前数据库状态导出为一份只读快照。 */
export async function snapshotGame(
  db: Database,
  gameRef: string,
  options: GameSnapshotOptions = {},
) {
  const state = await getGameState(db, gameRef);
  const memories = await getGameMemories(db, state.game.id);
  const now = options.now ?? new Date();
  const session: SessionEvent[] = state.messages.map((message) => ({
    sequence: message.sequence,
    type: `message.${message.kind}`,
    at: message.createdAt,
    payload: {
      stageId: message.stageId,
      sourceActorId: message.sourceActorId,
      targetActorId: message.targetActorId,
      visibility: message.visibility,
      content: message.content,
    },
  }));

  const memoryParts = Object.fromEntries(
    memories.flatMap((memory) => [
      [`memories/${memoryFileName(memory.name)}.json`, memory as unknown as JsonValue],
      [
        `memories/${memoryFileName(memory.name)}.meta.json`,
        {
          id: memory.id,
          ownerType: memory.ownerType,
          ownerId: memory.ownerId,
          name: memory.name,
          contextUsageRatio: memory.contextUsageRatio,
          messageCount: memory.messages.length,
        } as JsonValue,
      ],
    ]),
  );

  const snapshot = await saveSnapshot({
    root: options.root,
    user: state.player.username,
    game: state.game.slug,
    snapshotId: `${formatSnapshotId(now)}-v${state.game.version}`,
    world: state as unknown as JsonValue,
    session,
    parts: {
      "game.json": state.game as unknown as JsonValue,
      "messages.json": state.messages as unknown as JsonValue,
      ...memoryParts,
    },
    action: options.action ?? "snapshot",
    source: "db",
    gameId: state.game.id,
    dbVersion: state.game.version,
    contentVersion: state.game.contentVersion,
    now,
  });

  return { state, snapshot };
}

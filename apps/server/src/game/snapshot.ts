import type { Database } from "../db/pool";
import {
  formatSnapshotId,
  type JsonValue,
  type SessionEvent,
  saveSnapshot,
} from "../debug/snapshot";
import { getGameState } from "./service";

export type GameSnapshotOptions = {
  root?: string;
  action?: string;
  now?: Date;
};

export async function snapshotGame(
  db: Database,
  gameRef: string,
  options: GameSnapshotOptions = {},
) {
  const state = await getGameState(db, gameRef);
  const now = options.now ?? new Date();
  const session: SessionEvent[] = state.messages.map((message) => ({
    sequence: message.sequence,
    type: `message.${message.kind}`,
    at: message.createdAt,
    payload: {
      speakerActorId: message.speakerActorId,
      content: message.content,
    },
  }));

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

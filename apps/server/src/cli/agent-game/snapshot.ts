import type { Database } from "../../db/pool";
import {
  formatSnapshotId,
  type JsonValue,
  type SessionEvent,
  saveSnapshot,
} from "../../debug/snapshot";
import { getGameMemories } from "../../game/memory";
import { listGameMessages } from "../../game/read/game-messages";
import { getGameStateSlice } from "../../game/read/game-state";

/**
 * 把一局落成文件快照：唯一入口是 `agent:game snapshot`。
 *
 * 快照是提交后的只读投影，不是写入源；投影只在调试入口发生，所以引擎侧不留这份逻辑。
 */

/** 记忆文件名：保留可读性，只替换路径分隔符与文件名非法字符。 */
function memoryFileName(name: string): string {
  return name.replace(/[/\\\0:*?"<>|]/g, "_").replace(/^\.+$/, "_") || "actor";
}

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
  // 快照是控制面：活状态与公共事件流各自取，事件流可以单独分页。
  const slice = await getGameStateSlice(db, gameRef);
  const messages = await listGameMessages(db, slice.game.id);
  const state = { ...slice, messages };
  const memories = await getGameMemories(db, state.game.id);
  const now = options.now ?? new Date();
  const session: SessionEvent[] = messages.map((message) => ({
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

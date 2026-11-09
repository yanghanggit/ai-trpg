import type { Database } from "../../db/pool";
import type { TraceContext } from "../../debug/trace";
import { mentionOf } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { MEMORY_KINDS } from "../constants";
import { GameError } from "../errors";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { renderAction, withAppearances } from "../observation-text";
import {
  appendCustomStageObservation,
  appendSelfObservation,
  appendStageMemory,
} from "../observations";
import { claimDeath } from "../persistence/deaths";
import { loadWorldByGame } from "../persistence/worlds";

/**
 * 宣布死亡：一个事务里认领死者、广播倒下、写场景事件与死者自己的记忆。
 *
 * 认领（`claimDeath`）是并发下的唯一裁决点：输了就说明别人已经宣布，直接返回 false，
 * 不重复广播；死者刚复活也在这里被挡住。
 */

/** 宣布一个 actor 死亡；认领失败（别人已宣布，或死者刚复活）时返回 false。 */
export async function announceDeath(
  db: Database,
  gameId: string,
  actor: { id: string; name: string; stageId: string; isDefaultPlayer: boolean },
  trace?: TraceContext,
): Promise<boolean> {
  const content = `${actor.name}倒下了，不再有任何生命迹象。`;
  const now = new Date();
  return db.transaction(async (tx) => {
    if (!(await claimDeath(tx, actor.id, now))) {
      return false;
    }
    await appendPublicMessage(tx, gameId, null, {
      kind: "death",
      stageId: actor.stageId,
      targetActorId: actor.id,
      visibility: "stage",
      content,
    });
    await appendStageMemory(
      tx,
      gameId,
      actor.stageId,
      `# 生命事件\n${actor.name}的生命归零。`,
      { eventKind: "death", targetActorId: actor.id },
      trace,
    );
    await appendCustomStageObservation(
      tx,
      gameId,
      actor.stageId,
      actor.id,
      (_observerId, address) =>
        renderAction(
          withAppearances(
            `# 场景动态\n${mentionOf(address(actor.id))}倒下了，不再有任何生命迹象。`,
            [address(actor.id)],
          ),
          actor.stageId,
        ),
      trace,
    );
    // 死者自己也留一条：复活类扩展需要知道「我死过」。
    await appendSelfObservation(
      tx,
      gameId,
      actor.stageId,
      actor.id,
      "# 你的生命归零\n你已经死亡。",
      {},
      trace,
    );
    if (actor.isDefaultPlayer) {
      await appendDefaultPlayerDeath(tx, gameId, actor);
    }
    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

/**
 * 主角死亡也走同一条通知通道：world 下一回合看到这条事实，自己决定怎么收尾。
 * 框架不替它写结局，也不在这里结束整局。
 */
async function appendDefaultPlayerDeath(
  executor: Parameters<typeof loadWorldByGame>[0],
  gameId: string,
  actor: { id: string; name: string; stageId: string },
): Promise<void> {
  const world = await loadWorldByGame(executor, gameId);
  if (!world) {
    throw new GameError("not_found", `游戏缺少 world: ${gameId}`);
  }
  const memory = await loadAgentMemory(executor, gameId, "world", world.id);
  if (!memory) {
    throw new GameError("invalid_state", `world 缺少 memory: ${world.id}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: `# 主角死亡\n${actor.name}倒下了，生命归零。`,
      metadata: {
        kind: MEMORY_KINDS.worldEvent,
        stageId: actor.stageId,
        actorId: actor.id,
      },
    },
  ]);
}

import type { Database } from "../../../db/pool";
import { type TraceContext, traceEvent } from "../../../debug/trace";
import type { Logger } from "../../../logging";
import { describeError, GameError } from "../../errors";
import { mentionOf } from "../../kernel/addressing";
import { renderAction, withAppearances } from "../../kernel/observation-text";
import { appendWorldEvent } from "../../memory";
import {
  appendCustomStageObservation,
  appendSelfObservation,
  appendStageMemory,
} from "../../observations";
import { claimDeath, type PendingDeath } from "../../persistence/deaths";
import { appendPublicMessage } from "../../persistence/game-messages";
import { bumpGameVersion } from "../../persistence/games";
import { loadWorldByGame } from "../../persistence/worlds";

/**
 * 宣布死亡：一个事务里认领死者、广播倒下、写场景事件与死者自己的记忆。
 *
 * 文件叫 `declare` 而不是 `announce`：`announce` 是角色动作的名字（`actions/announce.ts`），
 * 而这里写的是引擎认定的事实，两者不该同名。认领（`claimDeath`）是并发下的唯一裁决点：
 * 输了就说明别人已经宣布，直接返回 false，不重复广播；死者刚复活也在这里被挡住。
 * 主角死亡对 world 的通知排在事务之后，走 `memory/world-channel.ts`——world 聚合
 * 不完整不能反过来否定已经宣布的事实。
 */

/** 宣布一个 actor 死亡；认领失败（别人已宣布，或死者刚复活）时返回 false。 */
export async function declareDeath(
  db: Database,
  gameId: string,
  actor: PendingDeath,
  options: { trace?: TraceContext; logger?: Logger } = {},
): Promise<boolean> {
  const { trace, logger } = options;
  const content = `${actor.name}倒下了，不再有任何生命迹象。`;
  const now = new Date();
  const declared = await db.transaction(async (tx) => {
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
    await bumpGameVersion(tx, gameId, now);
    return true;
  });
  if (!declared) {
    return false;
  }
  if (actor.isDefaultPlayer) {
    await notifyWorldOfPlayerDeath(db, gameId, actor, trace, logger);
  }
  return true;
}

/**
 * 把「主角死亡」告诉 world：world 下一回合看到这条事实，自己决定怎么收尾。
 *
 * 框架不替它写结局，也不在这里结束整局。失败只告警：通知丢了不等于死亡没发生，
 * 所以这一步在认领事务之外，也不影响该死者的外观与掉落。
 */
async function notifyWorldOfPlayerDeath(
  db: Database,
  gameId: string,
  actor: PendingDeath,
  trace?: TraceContext,
  logger?: Logger,
): Promise<void> {
  try {
    const world = await loadWorldByGame(db, gameId);
    if (!world) {
      throw new GameError("not_found", `游戏缺少 world: ${gameId}`);
    }
    await appendWorldEvent(
      db,
      gameId,
      world.id,
      {
        content: `# 主角死亡\n${actor.name}倒下了，生命归零。`,
        stageId: actor.stageId,
        actorId: actor.id,
      },
      trace,
    );
  } catch (error) {
    logger?.warn(`主角死亡未能通知 world: ${actor.name}`, error);
    await traceEvent(trace, {
      event: "phase",
      name: "world-notice",
      status: "failed",
      actorName: actor.name,
      detail: { reason: describeError(error) },
    });
  }
}

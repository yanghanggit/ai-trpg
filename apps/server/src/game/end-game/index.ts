import type { Database } from "../../db/pool";
import { GameError } from "../errors";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion, completeGameIfActive, lockGameRow } from "../persistence/games";

/**
 * 结束一局：状态位翻成 completed，可选再写一条公共结束事件。
 *
 * 只做单向转移，不铺开结局、评分与归档。与 world 回合的结束共用 `completeGameIfActive`，
 * 并发下只有一个生效，重复结束回同一份状态；正文归调用方，不给就不写事件。
 */
export type EndGameInput = {
  /** 世界自己命名的结局标签，与 world 写的同一列。 */
  outcome: string;
  /** 玩家可见的结束正文；不传则不写事件。 */
  message?: string;
};

export async function endGame(
  db: Database,
  gameId: string,
  input: EndGameInput,
): Promise<{ ended: boolean }> {
  const outcome = input.outcome.trim();
  if (outcome.length === 0) {
    throw new GameError("invalid_action", "结局标签不能为空");
  }
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    const now = new Date();
    const ended = await completeGameIfActive(tx, gameId, now, outcome);
    if (!ended) {
      return { ended };
    }
    const message = input.message?.trim() ?? "";
    if (message.length > 0) {
      await appendPublicMessage(tx, gameId, null, {
        kind: "game_completed",
        stageId: null,
        visibility: "stage",
        content: message,
      });
    }
    // 结束也是一次写入：客户端的视图版本必须跟着变，否则它拿旧版本去比对永远对不上。
    await bumpGameVersion(tx, gameId, now);
    return { ended };
  });
}

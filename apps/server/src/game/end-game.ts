import { appendPublicMessage } from "./apply/messages";
import type { Executor } from "./apply/types";
import { completeGameIfActive } from "./persistence/games";

export type CompleteGameOptions = {
  /** 结局标签，由 world 自己命名。 */
  outcome: string;
  now?: Date;
  stageId?: string | null;
};

/**
 * 把一局游戏置为 completed，并写一条公共结束事件。
 *
 * 只有 world 的 end_game 调用这里；调用方给出结局标签、结束文案与可选场景。
 * 已经结束的游戏不会重复写事件。
 */
export async function completeGame(
  executor: Executor,
  gameId: string,
  message: string,
  options: CompleteGameOptions,
): Promise<boolean> {
  const now = options.now ?? new Date();
  const completed = await completeGameIfActive(executor, gameId, now, options.outcome);
  if (!completed) {
    return false;
  }
  await appendPublicMessage(executor, gameId, null, {
    kind: "game_completed",
    stageId: options.stageId ?? null,
    visibility: "stage",
    content: message,
  });
  return true;
}

import type { Database } from "../../db/pool";
import type { TraceContext } from "../../debug/trace";
import { bumpGameVersion } from "../apply/messages";
import type { MemoryTarget } from "../bypass";
import { GameError } from "../errors";
import { appearanceChangeText, renderAppearanceChange } from "../observation-text";
import { appendCustomStageObservation, appendSelfObservation } from "../observations";
import { type AppearanceContext, recordAppearance } from "../persistence/appearances";
import { lockGameRow } from "../persistence/games";
import { buildSubmitAppearanceTool } from "./prompt";

/** 落账要写的东西：新外观 + 生成它的输入快照 + 广播策略。 */
export type AppearanceSnapshot = {
  target: MemoryTarget;
  appearance: string;
  /** 这次生成用的输入，原样进审计快照。 */
  inputMessage: string;
  maxRounds: number;
  context: AppearanceContext;
  /** 是否把这次可见变化写进观察：广播策略归调用方。 */
  notify: boolean;
  trace?: TraceContext;
};

/**
 * 落账：写回一条当前外观，`notify` 时再广播这次可见变化。
 *
 * 一个事务：锁游戏、旧记录标为已取代、写新记录、可选广播、递增 game version。
 * 广播与落账因此要么一起发生、要么都不发生，不存在「外观变了但没人被通知」的中间态。
 *
 * 外观变化是可见事实：自己一条用「你」，旁人各一条用观察者相对的引用，都不带真名。
 */
export async function writeAppearanceSnapshot(
  db: Database,
  write: AppearanceSnapshot,
): Promise<void> {
  const { target, appearance, inputMessage, maxRounds, context, notify, trace } = write;
  const { state, actor, stage, memory } = target;
  const now = new Date();

  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能更新外观: ${game.status}`);
    }
    await recordAppearance(tx, {
      gameId: state.game.id,
      actorId: actor.id,
      text: appearance,
      input: {
        source: "runtime",
        // provider 契约尚未暴露模型名；先留空，不为审计改 LLM 基建。
        model: null,
        prompt: {
          messages: memory.messages,
          inputMessage,
          tools: [buildSubmitAppearanceTool()],
          maxRounds,
        },
        context,
      },
      now,
    });
    if (notify) {
      // 外观已写库：渲染取到的是新值。自己看是「你」，旁人看是观察者相对的引用。
      await appendSelfObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        appearanceChangeText("你", appearance),
        {},
        trace,
      );
      await appendCustomStageObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        (_observerId, address) => renderAppearanceChange(address(actor.id), appearance, stage.id),
        trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });
}

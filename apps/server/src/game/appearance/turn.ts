import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { DEFAULT_ERROR_RETRIES } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { findActorByName } from "../actors";
import { bumpGameVersion } from "../apply/messages";
import { isAlive } from "../apply/queries";
import { GameError } from "../errors";
import { loadAgentMemory } from "../memory";
import { renderAppearanceChange } from "../observation-text";
import { appendCustomStageObservation } from "../observations";
import { recordAppearance } from "../persistence/appearances";
import { lockGameRow } from "../persistence/games";
import { getGameStateSlice, readTurnDelivery } from "../read/game-state";
import { DEFAULT_APPEARANCE_MAX_ROUNDS } from "../rounds";
import type { EquipmentSlot, TurnDelivery } from "../types";
import {
  buildAppearanceTurnInput,
  buildSubmitAppearanceBriefTool,
  buildSubmitAppearanceTool,
  parseAppearance,
  parseAppearanceBrief,
} from "./prompt";

export type AppearanceTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: Parameters<typeof agentLoop>[0]["trace"];
  /** 死亡阶段的外观更新：写尸体而不是活人。 */
  dead?: boolean;
  /** 调用方已知的本次变化简报；有值时不再让角色自己生成。 */
  brief?: string;
  /** 是否先让角色自己提交一段变化简报，再生成最终外观；死亡阶段使用。 */
  requestBrief?: boolean;
  /**
   * 写回后是否向同场景其他 actor 广播外观变化。默认开；死亡收尾与批量维护
   * 关掉，避免在已有广播的事件后面重复贴一条。
   */
  broadcast?: boolean;
};

export type AppearanceTurnResult = TurnDelivery & {
  ok: boolean;
  appearance: string | null;
};

export type EquipmentResult = AppearanceTurnResult & {
  slot: EquipmentSlot;
  itemName: string | null;
};

/**
 * 只更新运行时外观，不改 system prompt：签名上的 form 才是稳定身份。
 */
export async function runAppearanceTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceTurnOptions,
): Promise<AppearanceTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const { actor, stage } = findActorByName(state, actorRef);
  const actorNames = state.world.stages.flatMap((candidate) =>
    candidate.actors.map((present) => present.name),
  );
  const memory = await loadAgentMemory(db, state.game.id, "actor", actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${actor.name}`);
  }

  const tool = buildSubmitAppearanceTool();
  const providedBrief = options.brief
    ? parseAppearanceBrief({ brief: options.brief }, actorNames)
    : null;
  const briefTool =
    options.requestBrief && !providedBrief ? buildSubmitAppearanceBriefTool() : null;
  const tools = briefTool ? [tool, briefTool] : [tool];
  let submitted: string | null = null;
  let submittedBrief: string | null = null;
  const dead = !isAlive(actor);
  const maxRounds =
    options.maxRounds ??
    (briefTool ? DEFAULT_APPEARANCE_MAX_ROUNDS + 1 : DEFAULT_APPEARANCE_MAX_ROUNDS);
  const built = buildAppearanceTurnInput(
    actor,
    dead,
    providedBrief ?? undefined,
    options.requestBrief,
  );
  const handlers: Record<string, (args: Record<string, unknown>) => string> = {
    [tool.function.name]: (args) => {
      if (submitted !== null) {
        throw new GameError("invalid_action", "外观已提交");
      }
      submitted = parseAppearance(args, actorNames);
      return "外观已提交";
    },
  };
  if (briefTool) {
    handlers[briefTool.function.name] = (args) => {
      if (submittedBrief !== null) {
        throw new GameError("invalid_action", "变化简报已提交");
      }
      submittedBrief = parseAppearanceBrief(args, actorNames);
      return "简报已记录。现在调用 submit_appearance 提交最终外观。";
    };
  }
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: built.inputMessage,
    messages: memory.messages,
    mutateMessages: false,
    tools,
    handlers,
    terminalTools: [tool],
    service: options.service,
    maxRounds,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success || submitted === null) {
    return { ...(await readTurnDelivery(db, state.game.id)), ok: false, appearance: null };
  }
  const appearance = submitted;

  const now = new Date();
  const broadcast = options.broadcast !== false && !dead;
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
        version: 1,
        source: "runtime",
        // provider 契约尚未暴露模型名；先留空，不为审计改 LLM 基建。
        model: null,
        prompt: {
          messages: memory.messages,
          inputMessage: built.inputMessage,
          tools,
          maxRounds,
        },
        context: {
          ...built.context,
          contentVersion: state.game.contentVersion,
          ...((providedBrief ?? submittedBrief)
            ? { brief: providedBrief ?? submittedBrief ?? undefined }
            : {}),
        },
      },
      now,
    });
    if (broadcast) {
      // 外观已写库：观察者渲染取到的是新值。引用按观察者渲染，名字不会外泄。
      await appendCustomStageObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        (_observerId, address) => renderAppearanceChange(address(actor.id), appearance, stage.id),
        options.trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    appearance,
    ...(await readTurnDelivery(db, state.game.id)),
  };
}

import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { DEFAULT_ERROR_RETRIES, loopErrorReason } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { findActorByName } from "../actor-state";
import { bumpGameVersion } from "../apply/messages";
import { DEFAULT_DROP_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { appendStageMemory } from "../observations";
import { lockGameRow } from "../persistence/games";
import { addActorMaterials, type MaterialDrop } from "../persistence/items";
import { getGameStateSlice, readTurnDelivery } from "../read/game-state";
import type { TurnDelivery } from "../types";
import { buildDropMaterialsTool, parseDrops } from "./materials";
import { buildDropSystemPrompt, buildDropTurnInput } from "./prompt";

export type DropTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: Parameters<typeof agentLoop>[0]["trace"];
};

export type DropTurnResult = TurnDelivery & {
  ok: boolean;
  /** 真正留在尸体上的材料名；模型返回空数组时也是 `ok`。 */
  dropped: string[];
  /** 没生成时的原因：loop 失败，或模型没调用提交工具。 */
  reason?: string;
};

/**
 * 掉落阶段：跑一次推理，把尸体留下的材料写进它自己的背包。
 *
 * 只见尸体与所在场景；落账与场景记忆在同一个事务里，事务外只有 LLM 调用。
 * 幂等由调用方的死亡认领保证：一次死亡只掉一次，这里不另设标记。
 */
export async function runDropTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: DropTurnOptions,
): Promise<DropTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActorByName(state, actorRef).actor;
  const stage = state.world.stages.find((candidate) =>
    candidate.actors.some((member) => member.id === actor.id),
  );
  if (!stage) {
    throw new GameError("invalid_state", `actor 不属于任何场景: ${actor.name}`);
  }

  const tool = buildDropMaterialsTool();
  const submitted: { materials: MaterialDrop[] | null } = { materials: null };
  const actorNames = state.world.stages.flatMap((candidate) =>
    candidate.actors.map((member) => member.name),
  );
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: buildDropTurnInput(actor, stage),
    messages: [{ type: "system", content: buildDropSystemPrompt(state.world) }],
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (submitted.materials !== null) {
          throw new GameError("invalid_action", "掉落已提交");
        }
        submitted.materials = parseDrops(args, actorNames);
        return "掉落已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_DROP_MAX_ROUNDS,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success || submitted.materials === null) {
    const reason = loop.success
      ? "模型未调用 drop_materials 提交掉落"
      : (loopErrorReason(loop) ?? "推理未完成");
    return {
      ...(await readTurnDelivery(db, state.game.id)),
      ok: false,
      dropped: [],
      reason,
    };
  }
  const dropped = submitted.materials;
  let written: string[] = [];

  const now = new Date();
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能掉落材料: ${game.status}`);
    }
    ({ written } = await addActorMaterials(tx, state.game.id, actor.id, actor.name, dropped));
    if (written.length > 0) {
      const list = dropped
        .filter((material) => written.includes(material.name))
        .map((material) => `${material.name} ×${material.count}`)
        .join("、");
      await appendStageMemory(
        tx,
        state.game.id,
        stage.id,
        `# 尸体遗留\n${actor.name}的尸体上多了：${list}。`,
        { eventKind: "drop", targetActorId: actor.id },
        options.trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    dropped: written,
    ...(await readTurnDelivery(db, state.game.id)),
  };
}

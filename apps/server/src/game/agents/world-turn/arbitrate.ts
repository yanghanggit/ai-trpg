import type { Database } from "../../../db/pool";
import { type TraceContext, traceEvent } from "../../../debug/trace";
import { GameError } from "../../errors";
import { MAX_WORLD_ACTIONS_PER_TURN } from "../../kernel/limits";
import type { WorldPlan } from "../../kernel/types";
import { appendMemoryMessages, loadAgentMemory } from "../../memory";
import { MEMORY_KINDS } from "../../memory/kinds";
import { appendStageDirective } from "../../memory/world-channel";
import { appendPublicMessage } from "../../persistence/game-messages";
import { bumpGameVersion, completeGameIfActive, lockGameRow } from "../../persistence/games";
import type { Executor } from "../../persistence/rows";
import { listStagesOfWorld } from "../../persistence/stages";
import { loadWorldByGame } from "../../persistence/worlds";

/** 把 world 的动作应用到数据库；业务校验失败时写 world memory 并返回 false。 */
export async function applyWorldPlan(
  db: Database,
  gameId: string,
  plan: WorldPlan | null,
  loopSuccess: boolean,
  trace?: TraceContext,
): Promise<boolean> {
  await traceEvent(trace, { event: "plan", actions: plan?.actions ?? [] });
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能继续行动: ${game.status}`);
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "world", world.id);
    if (!memory) {
      throw new GameError("invalid_state", `world 缺少 memory: ${world.id}`);
    }
    const actions = plan?.actions ?? [];
    const worldActions = world.actions;

    const reject = async (content: string): Promise<false> => {
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 世界裁决\n${content}`,
          metadata: { kind: MEMORY_KINDS.actionRejected, loopSuccess },
        },
      ]);
      await traceEvent(trace, {
        event: "rejected",
        code: MEMORY_KINDS.actionRejected,
        reason: content,
      });
      return false;
    };

    // 没提交计划 = 回合没走完（失败或漏调终止工具），仍算拒绝；
    // 显式提交空计划 = 本轮没有世界级变更，是合法的 no-op，不写记忆也不改版本。
    if (plan === null) {
      return reject("本轮没有提交有效世界计划，状态未改变。");
    }
    if (actions.length === 0) {
      return true;
    }
    if (actions.length > MAX_WORLD_ACTIONS_PER_TURN) {
      return reject(`本轮最多 ${MAX_WORLD_ACTIONS_PER_TURN} 个世界动作。`);
    }
    const endIndex = actions.findIndex((action) => action.kind === "end_game");
    if (endIndex !== -1 && endIndex !== actions.length - 1) {
      return reject("end_game 必须是本轮最后一个动作。");
    }
    for (const action of actions) {
      if (action.kind === "end_game" && !worldActions.includes("end_game")) {
        return reject("world 没有 end_game 能力。");
      }
      if (action.kind === "notify_stage" && !worldActions.includes("notify_stage")) {
        return reject("world 没有 notify_stage 能力。");
      }
    }

    const stageRows = await listStagesOfWorld(tx, world.id);
    const stageByName = new Map(stageRows.map((stage) => [stage.name, stage]));
    for (const action of actions) {
      if (action.kind === "notify_stage" && !stageByName.has(action.stageName)) {
        return reject(`world 找不到目标场景: ${action.stageName}`);
      }
    }

    const now = new Date();
    let completed = false;
    for (const action of actions) {
      if (action.kind === "notify_stage") {
        const stage = stageByName.get(action.stageName);
        if (!stage) {
          throw new GameError("invalid_state", `world 找不到目标场景: ${action.stageName}`);
        }
        await appendStageDirective(tx, gameId, stage.id, world.id, action.content, trace);
        await traceEvent(trace, {
          event: "applied",
          actionKind: action.kind,
          detail: { stageName: action.stageName },
        });
        continue;
      }

      await endGame(tx, gameId, action.message, action.outcome, now);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 世界结果\n${action.message}`,
          metadata: { kind: MEMORY_KINDS.worldDirective },
        },
      ]);
      await traceEvent(trace, {
        event: "applied",
        actionKind: action.kind,
        detail: { outcome: action.outcome },
      });
      completed = true;
    }

    await bumpGameVersion(tx, gameId, now);
    return completed || actions.length > 0;
  });
}

/**
 * 结束一局：状态位翻成 completed，再写一条公共结束事件；两者只能一起发生。
 *
 * 已经结束的游戏不再写第二条事件，所以先看状态位是否真的翻过来了——
 * `completeGameIfActive` 是并发下的裁决点。
 */
async function endGame(
  executor: Executor,
  gameId: string,
  message: string,
  outcome: string,
  now: Date,
): Promise<void> {
  if (!(await completeGameIfActive(executor, gameId, now, outcome))) {
    return;
  }
  await appendPublicMessage(executor, gameId, null, {
    kind: "game_completed",
    stageId: null,
    visibility: "stage",
    content: message,
  });
}

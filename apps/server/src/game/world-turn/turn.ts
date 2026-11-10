import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { createTurnTrace, traceEvent } from "../../debug/trace";
import { DEFAULT_ERROR_RETRIES } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { DEFAULT_WORLD_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { getGameStateSlice, readTurnDelivery } from "../game-state";
import { loadAgentMemory } from "../memory";
import type { WorldAction, WorldTurnResult } from "../types";
import { applyWorldPlan } from "./arbitrate";
import { createWorldPlanSession } from "./plan-session";
import { buildWorldTurnInput } from "./prompt";
import {
  buildEndGameTool,
  buildLookTool,
  buildNotifyStageTool,
  buildSubmitWorldPlanTool,
  describeStageForWorld,
  parseEndGame,
  parseNotifyStage,
} from "./tools";

export type WorldTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 推进一个 world 回合；由调用方显式触发，不随 actor/stage 自动运行。 */
export async function runWorldTurn(
  db: Database,
  gameRef: string,
  options: WorldTurnOptions,
): Promise<WorldTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const memory = await loadAgentMemory(db, state.game.id, "world", state.world.id);
  if (!memory) {
    throw new GameError("invalid_state", `world 缺少 memory: ${state.world.name}`);
  }

  const trace = createTurnTrace({ game: state.game, turnKind: "world" });
  await traceEvent(trace, {
    event: "turn_start",
    label: state.world.name,
    contentVersion: state.game.contentVersion,
  });

  const lookTool = buildLookTool(state);
  const notifyTool = buildNotifyStageTool(state.world.stages.map((stage) => stage.name));
  const endTool = buildEndGameTool();
  const submitTool = buildSubmitWorldPlanTool();
  const session = createWorldPlanSession();
  const canNotify = state.world.actions.includes("notify_stage");
  const canEnd = state.world.actions.includes("end_game");

  const loop = await agentLoop({
    name: state.world.name,
    inputMessage: buildWorldTurnInput(state),
    messages: memory.messages,
    tools: [lookTool, ...(canNotify ? [notifyTool] : []), ...(canEnd ? [endTool] : []), submitTool],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return describeStageForWorld(state, stageName);
      },
      ...(canNotify
        ? {
            [notifyTool.function.name]: (args: Record<string, unknown>) => {
              const action: WorldAction = parseNotifyStage(args);
              session.add(action);
              return `${action.kind} 已加入计划`;
            },
          }
        : {}),
      ...(canEnd
        ? {
            [endTool.function.name]: (args: Record<string, unknown>) => {
              const action: WorldAction = parseEndGame(args);
              session.add(action);
              return `${action.kind} 已加入计划`;
            },
          }
        : {}),
      [submitTool.function.name]: () => {
        const empty = session.plan === null;
        session.submit();
        return empty ? "世界计划已提交：本轮无世界级变更" : "世界计划已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_WORLD_MAX_ROUNDS,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
  });

  const ok = await applyWorldPlan(db, state.game.id, session.plan, loop.success, trace);
  await traceEvent(trace, { event: "turn_end", ok, loopSuccess: loop.success });

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok,
    plan: session.plan,
    loopSuccess: loop.success,
  };
}

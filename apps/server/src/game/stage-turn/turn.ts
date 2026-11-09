import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { createTurnTrace, traceEvent } from "../../debug/trace";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { findStage } from "../actors";
import { DEFAULT_LLM_ERROR_RETRIES, DEFAULT_STAGE_MAX_ROUNDS } from "../constants";
import { GameError } from "../errors";
import { loadAgentMemory } from "../memory";
import { buildStageInspectTool, buildSubmitStagePlanTool, describeObservedActor } from "../plan";
import { getGameStateSlice, readTurnDelivery } from "../read/game-state";
import type { StageTurnResult } from "../types";
import { applyStagePlan } from "./arbitrate";
import { STAGE_ACTION_KINDS, stageTurnContext } from "./context";
import { createStagePlanSession } from "./plan-session";
import { renderStageTurnInput } from "./prompt";
import { STAGE_ACTION_TOOLKITS } from "./toolkit";

export type StageTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** stage 回合由调用方显式推动，不随 actor 行动自动运行。 */
export async function runStageTurn(
  db: Database,
  gameRef: string,
  stageRef: string,
  options: StageTurnOptions,
): Promise<StageTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const stage = findStage(state, stageRef);
  const memory = await loadAgentMemory(db, state.game.id, "stage", stage.id);
  if (!memory) {
    throw new GameError("invalid_state", `stage 缺少 memory: ${stage.name}`);
  }

  const trace = createTurnTrace({ game: state.game, turnKind: "stage" });
  await traceEvent(trace, {
    event: "turn_start",
    label: stage.name,
    stageId: stage.id,
    stageName: stage.name,
    contentVersion: state.game.contentVersion,
  });

  const context = stageTurnContext(state, stage);
  const inspectTool = buildStageInspectTool(context.actorNames);
  const planTool = buildSubmitStagePlanTool();
  const session = createStagePlanSession();

  // 能力清单是上限，具体工具还要看此刻有没有用武之地（例如通道全开着就没有 open_passage）。
  const toolKinds = STAGE_ACTION_KINDS.filter(
    (kind) =>
      context.allowed.includes(kind) && (STAGE_ACTION_TOOLKITS[kind].available?.(context) ?? true),
  );

  const actionHandlers = Object.fromEntries(
    toolKinds.map((kind) => [
      kind,
      (args: Record<string, unknown>) => STAGE_ACTION_TOOLKITS[kind].apply(session, args),
    ]),
  );

  const loop = await agentLoop({
    name: stage.name,
    inputMessage: renderStageTurnInput(context),
    messages: memory.messages,
    tools: [
      inspectTool,
      ...toolKinds.map((kind) => STAGE_ACTION_TOOLKITS[kind].build(context)),
      planTool,
    ],
    handlers: {
      [inspectTool.function.name]: (args) => {
        const targetActorRef =
          typeof args.targetActorRef === "string" ? args.targetActorRef.trim() : "";
        const target = stage.actors.find((actor) => actor.name === targetActorRef);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorRef}`;
        }
        return describeObservedActor(target);
      },
      ...actionHandlers,
      [planTool.function.name]: () => {
        session.submit();
        return "计划已提交";
      },
    },
    terminalTools: [planTool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_STAGE_MAX_ROUNDS,
    errorRetries: DEFAULT_LLM_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
  });

  const ok = await applyStagePlan(db, state.game.id, stage.id, session.plan, loop.success, trace);
  await traceEvent(trace, { event: "turn_end", ok, loopSuccess: loop.success });

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok,
    plan: session.plan,
    loopSuccess: loop.success,
  };
}

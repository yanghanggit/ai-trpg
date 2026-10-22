import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import { DEFAULT_NPC_MAX_ROUNDS } from "./actions";
import {
  type ActorWithStage,
  adjacentStageNames,
  findActorWithStage,
  otherActorsInStage,
} from "./actors";
import { applyActorPlan } from "./apply";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { loadAgentMemory } from "./memory";
import { buildLookTool, buildSubmitPlanTool, lookStage, parsePlan } from "./plan";
import { getGameState } from "./service";
import type { ActorActionPlan, ActorTurnResult, GameState } from "./types";

export type NpcTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 构造 NPC 本轮的公开环境与任务说明。 */
function buildObservation(state: GameState, current: ActorWithStage): string {
  const moves = adjacentStageNames(state, current.stage.id);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const targets = others.map((actor) => actor.name);
  return [
    "# 当前环境",
    `## 场景\n${current.stage.name}\n${current.stage.environment}\n${current.stage.narrative}`,
    `## 你的状态\n${current.actor.name} | HP ${current.actor.hp}/${current.actor.maxHp}`,
    `## 同场景角色\n${others.length === 0 ? "无" : others.map((actor) => `${actor.name}：${actor.appearance}`).join("\n")}`,
    `## 可交谈对象\n${targets.length === 0 ? "无" : targets.join("、")}`,
    `## 可移动至\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    "根据当前环境与自己的记忆决定行动，并调用工具提交计划。say 是有目标的公开说话，当前场景所有角色都会听见；whisper 是对一名角色的私下耳语，只有说话者与目标会听见；announce 是无目标的公开说话，当前场景所有角色都会听见。say/whisper 必须填写 targetActorName，announce/wait/move 留空。",
  ].join("\n\n");
}

/**
 * 为单个 actor 跑一轮 agent loop，应用提交的计划并返回最新状态。
 *
 * 被玩家接管的 actor 不进入 NPC loop。
 */
export async function runNpcTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: NpcTurnOptions,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const current = findActorWithStage(state, actorRef);
  if (await isPlayerControlled(db, state.game.id, current.actor.id)) {
    throw new GameError("invalid_action", `actor 已被玩家接管: ${current.actor.name}`);
  }

  const memory = await loadAgentMemory(db, state.game.id, current.actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
  }

  const availableStageNames = adjacentStageNames(state, current.stage.id);
  const availableTargetActorNames = otherActorsInStage(current.stage, current.actor.id).map(
    (actor) => actor.name,
  );
  const lookTool = buildLookTool(state);
  const submitTool = buildSubmitPlanTool(availableStageNames, availableTargetActorNames);
  let submitted: ActorActionPlan | null = null;

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildObservation(state, current),
    messages: memory.messages,
    tools: [lookTool, submitTool],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [submitTool.function.name]: (args) => {
        submitted = parsePlan(args);
        return "行动计划已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_NPC_MAX_ROUNDS,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const newMessages = loop.messages.slice(loop.startIndex, loop.endIndex);
  const ok = await applyActorPlan(
    db,
    state.game.id,
    current.actor.id,
    submitted,
    newMessages,
    loop.success,
  );

  return {
    ok,
    plan: submitted,
    loopSuccess: loop.success,
    state: await getGameState(db, state.game.id),
  };
}

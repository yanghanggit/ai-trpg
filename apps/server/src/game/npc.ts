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
import {
  addIntent,
  buildAttackTool,
  buildCommunicateTool,
  buildItemsTool,
  buildLookTool,
  buildMoveTool,
  buildStatsTool,
  buildSubmitPlanTool,
  describeItems,
  describeStats,
  lookStage,
  parseAttack,
  parseCommunication,
  parseMovement,
} from "./plan";
import { getGameState } from "./service";
import type { ActorPlan, ActorTurnResult, GameState } from "./types";

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
  const attackTargets = others.filter((actor) => !actor.death).map((actor) => actor.name);
  return [
    "# 当前环境",
    `## 场景\n${current.stage.name}\n${current.stage.environment}\n${current.stage.narrative}`,
    `## 你的状态\n${current.actor.name} | HP ${current.actor.hp}/${current.actor.maxHp}`,
    `## 同场景角色\n${others.length === 0 ? "无" : others.map((actor) => `${actor.name}：${actor.appearance}${actor.death ? "（已死亡）" : ""}`).join("\n")}`,
    `## 可交谈对象\n${targets.length === 0 ? "无" : targets.join("、")}`,
    `## 可攻击对象\n${attackTargets.length === 0 ? "无" : attackTargets.join("、")}`,
    `## 可移动至\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    "根据当前环境与自己的记忆决定行动。使用 get_stats / get_items 查看自己的 stats 与物品；需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。使用 communicate 添加沟通行动，使用 move 添加移动或等待行动，使用 attack 攻击同场景角色。沟通类与行动类各最多一个，先加入的 intent 先执行。最后调用 submit_plan 提交。look_stage、get_stats、get_items 不占计划。say/whisper 必须填写 targetActorName；move 使用 targetStageName；attack 使用 targetActorName。",
  ].join("\n\n");
}

/**
 * 为单个 actor 跑一轮 agent loop，应用提交的计划并返回最新状态。
 *
 * 已死亡或被玩家接管的 actor 不进入 NPC loop。
 */
export async function runNpcTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: NpcTurnOptions,
): Promise<ActorTurnResult> {
  const state = await getGameState(db, gameRef);
  const current = findActorWithStage(state, actorRef);
  if (current.actor.death) {
    throw new GameError("invalid_action", `actor 已死亡: ${current.actor.name}`);
  }
  if (await isPlayerControlled(db, state.game.id, current.actor.id)) {
    throw new GameError("invalid_action", `actor 已被玩家接管: ${current.actor.name}`);
  }

  const memory = await loadAgentMemory(db, state.game.id, current.actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
  }

  const availableStageNames = adjacentStageNames(state, current.stage.id);
  const otherActors = otherActorsInStage(current.stage, current.actor.id);
  const availableTargetActorNames = otherActors.map((actor) => actor.name);
  const availableAttackTargetActorNames = otherActors
    .filter((actor) => !actor.death)
    .map((actor) => actor.name);
  const lookTool = buildLookTool(state);
  const statsTool = buildStatsTool();
  const itemsTool = buildItemsTool();
  const communicateTool = buildCommunicateTool(availableTargetActorNames);
  const moveTool = buildMoveTool(availableStageNames);
  const attackTool = buildAttackTool(availableAttackTargetActorNames);
  const submitTool = buildSubmitPlanTool();
  const plan: ActorPlan = { intents: [] };
  let submitted: ActorPlan | null = null;

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildObservation(state, current),
    messages: memory.messages,
    tools: [lookTool, statsTool, itemsTool, communicateTool, moveTool, attackTool, submitTool],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [statsTool.function.name]: () => describeStats(current.actor),
      [itemsTool.function.name]: () => describeItems(current.actor),
      [communicateTool.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        addIntent(plan, parseCommunication(args));
        return "沟通行动已加入计划";
      },
      [moveTool.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        addIntent(plan, parseMovement(args));
        return "移动行动已加入计划";
      },
      [attackTool.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        addIntent(plan, parseAttack(args));
        return "攻击行动已加入计划";
      },
      [submitTool.function.name]: () => {
        if (plan.intents.length === 0) {
          throw new GameError("invalid_action", "计划中没有行动");
        }
        submitted = { intents: plan.intents.map((intent) => ({ ...intent })) };
        return "计划已提交";
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

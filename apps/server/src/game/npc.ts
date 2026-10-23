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
  buildActorInfoTool,
  buildCommunicateTool,
  buildInteractTool,
  buildItemsTool,
  buildLookTool,
  buildMoveTool,
  buildStatsTool,
  buildSubmitPlanTool,
  describeActor,
  describeItems,
  describeStats,
  lookStage,
  parseCommunication,
  parseInteract,
  parseMovement,
} from "./plan";
import { getGameState } from "./service";
import type { ActorPlan, ActorTurnResult, GameState } from "./types";

export type NpcTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 构造 actor 本轮的公开环境与任务说明；NPC 与探针共用。 */
export function buildActorObservation(state: GameState, current: ActorWithStage): string {
  const moves = adjacentStageNames(state, current.stage.id);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const targets = others.map((actor) => actor.name);
  const interactTargets = others.filter((actor) => !actor.death).map((actor) => actor.name);
  return [
    "# 当前环境",
    `## 场景\n${current.stage.name}\n${current.stage.environment}`,
    `## 你的状态\n${current.actor.name} | HP ${current.actor.hp}/${current.actor.maxHp}`,
    `## 状态效果\n${
      current.actor.statusEffects.length === 0
        ? "无"
        : current.actor.statusEffects
            .map((status) => `${status.name}：${status.description}`)
            .join("\n")
    }`,
    `## 同场景角色\n${others.length === 0 ? "无" : others.map((actor) => `${actor.name}：${actor.appearance}${actor.death ? "（已死亡）" : ""}`).join("\n")}`,
    `## 场景物品\n${current.stage.items.length === 0 ? "无" : current.stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("\n")}`,
    `## 可交谈对象\n${targets.length === 0 ? "无" : targets.join("、")}`,
    `## 可作用对象\n${interactTargets.length === 0 ? "无" : interactTargets.join("、")}`,
    `## 可移动至\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    "根据当前环境与自己的记忆决定行动。使用 get_stats / get_items 查看自己，使用 get_actor 查看同场景目标的状态与物品；需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。本轮的顶层行动只有三类：沟通（communicate）、移动（move）、交互（interact），其中移动与交互同属行动槽，二者一轮只能选一个，沟通可以与之共存。使用 interact 表达一次交互：purpose 选交互分支（想做什么），itemNames / itemName 选道具，targetActorName / targetStageName 绑定交互对象。damage 就是攻击，直接造成伤害；steal/give/pickup/use 分别是取物、给予、拾取与使用道具。先加入的 intent 先执行。最后调用 submit_plan 提交。look_stage、get_stats、get_items、get_actor 不占计划。say/whisper 必须填写 targetActorName；move 使用 targetStageName；interact 的 damage/steal/give 使用 targetActorName，pickup 使用 itemName，use 使用 itemName 加 targetActorName 或 targetStageName。",
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
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const current = findActorWithStage(state, actorRef);
  if (current.actor.death) {
    throw new GameError("invalid_action", `actor 已死亡: ${current.actor.name}`);
  }
  if (await isPlayerControlled(db, state.game.id, current.actor.id)) {
    throw new GameError("invalid_action", `actor 已被玩家接管: ${current.actor.name}`);
  }

  const memory = await loadAgentMemory(db, state.game.id, "actor", current.actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
  }

  const availableStageNames = adjacentStageNames(state, current.stage.id);
  const otherActors = otherActorsInStage(current.stage, current.actor.id);
  const availableTargetActorNames = otherActors.map((actor) => actor.name);
  const availableItemNames = current.actor.items.map((item) => item.name);
  const lookTool = buildLookTool(state);
  const statsTool = buildStatsTool();
  const itemsTool = buildItemsTool();
  const actorInfoTool = buildActorInfoTool(otherActors.map((actor) => actor.name));
  const communicateTool = buildCommunicateTool(availableTargetActorNames);
  const moveTool = buildMoveTool(availableStageNames);
  const interactTool = buildInteractTool(
    availableTargetActorNames,
    availableItemNames,
    current.stage.name,
    current.actor.name,
  );
  const submitTool = buildSubmitPlanTool();
  const plan: ActorPlan = { intents: [] };
  let submitted: ActorPlan | null = null;

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildActorObservation(state, current),
    messages: memory.messages,
    tools: [
      lookTool,
      statsTool,
      itemsTool,
      actorInfoTool,
      communicateTool,
      moveTool,
      interactTool,
      submitTool,
    ],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [statsTool.function.name]: () => describeStats(current.actor),
      [itemsTool.function.name]: () => describeItems(current.actor),
      [actorInfoTool.function.name]: (args) => {
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const target = otherActors.find((actor) => actor.name === targetActorName);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorName}`;
        }
        return describeActor(target);
      },
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
      [interactTool.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        addIntent(plan, parseInteract(args));
        return "交互行动已加入计划";
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

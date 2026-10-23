import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import { buildAnnounceTool, parseAnnounce } from "./actions/announce";
import { buildAttackTool, parseAttack } from "./actions/attack";
import { buildGiveTool, parseGive } from "./actions/give";
import { buildMoveTool, parseMove } from "./actions/move";
import { buildPickupTool, parsePickup } from "./actions/pickup";
import { buildSayTool, parseSay } from "./actions/say";
import { buildStealTool, parseSteal } from "./actions/steal";
import { buildUseTool, parseUse } from "./actions/use";
import { buildWaitTool, parseWait } from "./actions/wait";
import { buildWhisperTool, parseWhisper } from "./actions/whisper";
import {
  type ActorWithStage,
  adjacentStageNames,
  findActorWithStage,
  otherActorsInStage,
} from "./actors";
import { applyActorPlan } from "./apply";
import { DEFAULT_NPC_MAX_ROUNDS, MAX_ACTIONS_PER_TURN } from "./constants";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { loadAgentMemory } from "./memory";
import {
  buildActorInfoTool,
  buildItemsTool,
  buildLookTool,
  buildStatsTool,
  buildSubmitPlanTool,
  describeActor,
  describeItems,
  describeStats,
  lookStage,
} from "./plan";
import { getGameState } from "./service";
import type { ActorAction, ActorPlan, ActorTurnResult, GameState } from "./types";

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
  const aliveTargets = others.filter((actor) => !actor.death).map((actor) => actor.name);
  return [
    "# 当前环境",
    `## 场景\n${current.stage.name}\n${current.stage.environment}`,
    `## 你的状态\n${current.actor.name} | HP ${current.actor.hp}/${current.actor.maxHp}`,
    `## 同场景角色\n${
      others.length === 0
        ? "无"
        : others
            .map((actor) => `${actor.name}：${actor.appearance}${actor.death ? "（已死亡）" : ""}`)
            .join("\n")
    }`,
    `## 场景物品\n${
      current.stage.items.length === 0
        ? "无"
        : current.stage.items
            .map((item) => `${item.name}（${item.kind}）：${item.description}`)
            .join("\n")
    }`,
    `## 可交谈对象\n${targets.length === 0 ? "无" : targets.join("、")}`,
    `## 可作用对象\n${aliveTargets.length === 0 ? "无" : aliveTargets.join("、")}`,
    `## 可移动至\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    `根据当前环境与自己的记忆决定行动。使用 get_stats / get_items 查看自己，使用 get_actor 查看同场景目标的状态与物品；需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。可用的行动工具：say（对目标公开说话）、whisper（对目标耳语）、announce（向场景公开说话）、move（移动到相邻场景）、wait（留在原地）、attack（攻击同场景目标）、steal（从目标身上取物）、give（把自己的物品交给目标）、pickup（拾起场景物品）、use（用自己的物品作用于角色或场景）。本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动；通常一次沟通加一个其他行动，不要重复同一动作。先加入的行动先执行。最后调用 submit_plan 提交。look_stage、get_stats、get_items、get_actor 不占计划。`,
  ].join("\n\n");
}

/** 把动作加入本轮计划；条数上限在这里就告诉模型，避免提交后才被拒绝。 */
function addAction(actions: ActorAction[], action: ActorAction): void {
  if (actions.length >= MAX_ACTIONS_PER_TURN) {
    throw new GameError("invalid_action", `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动`);
  }
  actions.push(action);
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

  const stageNames = adjacentStageNames(state, current.stage.id);
  const otherActors = otherActorsInStage(current.stage, current.actor.id);
  const talkTargets = otherActors.map((actor) => actor.name);
  const aliveTargets = otherActors.filter((actor) => !actor.death).map((actor) => actor.name);
  const selfAndAlive = [current.actor.name, ...aliveTargets];
  const itemNames = current.actor.items.map((item) => item.name);

  const lookTool = buildLookTool(state);
  const statsTool = buildStatsTool();
  const itemsTool = buildItemsTool();
  const actorInfoTool = buildActorInfoTool(talkTargets);
  const sayTool = buildSayTool(talkTargets);
  const whisperTool = buildWhisperTool(talkTargets);
  const announceTool = buildAnnounceTool();
  const moveTool = buildMoveTool(stageNames);
  const waitTool = buildWaitTool();
  const attackTool = buildAttackTool(aliveTargets, itemNames);
  const stealTool = buildStealTool(talkTargets);
  const giveTool = buildGiveTool(aliveTargets);
  const pickupTool = buildPickupTool();
  const useTool = buildUseTool(itemNames, selfAndAlive, current.stage.name);
  const submitTool = buildSubmitPlanTool();

  const actions: ActorAction[] = [];
  let submitted: ActorPlan | null = null;

  /** 所有动作工具共用的提交前检查。 */
  const ensureOpen = () => {
    if (submitted) {
      throw new GameError("invalid_action", "计划已提交");
    }
  };

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildActorObservation(state, current),
    messages: memory.messages,
    tools: [
      lookTool,
      statsTool,
      itemsTool,
      actorInfoTool,
      sayTool,
      whisperTool,
      announceTool,
      moveTool,
      waitTool,
      attackTool,
      stealTool,
      giveTool,
      pickupTool,
      useTool,
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
      [sayTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseSay(args));
        return "say 已加入计划";
      },
      [whisperTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseWhisper(args));
        return "whisper 已加入计划";
      },
      [announceTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseAnnounce(args));
        return "announce 已加入计划";
      },
      [moveTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseMove(args));
        return "move 已加入计划";
      },
      [waitTool.function.name]: () => {
        ensureOpen();
        addAction(actions, parseWait());
        return "wait 已加入计划";
      },
      [attackTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseAttack(args));
        return "attack 已加入计划";
      },
      [stealTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseSteal(args));
        return "steal 已加入计划";
      },
      [giveTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseGive(args));
        return "give 已加入计划";
      },
      [pickupTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parsePickup(args));
        return "pickup 已加入计划";
      },
      [useTool.function.name]: (args) => {
        ensureOpen();
        addAction(actions, parseUse(args));
        return "use 已加入计划";
      },
      [submitTool.function.name]: () => {
        if (actions.length === 0) {
          throw new GameError("invalid_action", "计划中没有行动");
        }
        submitted = { actions: actions.map((action) => ({ ...action })) };
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

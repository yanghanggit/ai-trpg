import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import {
  type EmbeddingProvider,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../rag";
import { ACTION_SUMMARIES, allowedActionKinds } from "./actions";
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
  buildKnowledgeTool,
  buildLookTool,
  buildObserveActorTool,
  buildSelfInfoTool,
  buildSubmitPlanTool,
  describeKnowledgeResults,
  describeObservedActor,
  describeSelf,
  lookStage,
} from "./plan";
import { getGameState } from "./service";
import type { ActionKind, ActorAction, ActorPlan, ActorTurnResult, GameState } from "./types";

export type NpcTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 真实 RAG provider；仅 actions 中包含 query 的 actor 会使用。测试可注入假 provider。 */
  knowledgeProvider?: EmbeddingProvider;
};

/** 构造 actor 本轮的公开环境与任务说明；NPC 与探针共用。 */
export function buildActorObservation(state: GameState, current: ActorWithStage): string {
  const moves = adjacentStageNames(state, current.stage.id);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const targets = others.map((actor) => actor.name);
  const aliveTargets = others
    .filter((actor) => actor.status === "alive")
    .map((actor) => actor.name);
  const allowed = allowedActionKinds(current.actor.actions);
  const actionList = allowed.map((kind) => `${kind}（${ACTION_SUMMARIES[kind]}）`).join("、");
  const actorLines =
    others.length === 0
      ? "无"
      : others
          .map(
            (actor) =>
              `${actor.name}：${actor.appearance}${actor.status === "dead" ? "（已死亡）" : ""}`,
          )
          .join("\n");
  const itemLines =
    current.stage.items.length === 0
      ? "无"
      : current.stage.items
          .map((item) => `${item.name}（${item.kind}）：${item.description}`)
          .join("\n");
  const talks = targets.length === 0 ? "无" : targets.join("、");
  const interactables = aliveTargets.length === 0 ? "无" : aliveTargets.join("、");
  const moveLines = moves.length === 0 ? "无" : moves.join("、");
  const hasKnowledge = current.actor.actions.includes("query");
  const knowledgeHint = hasKnowledge
    ? "当问题涉及建筑、地理、历史、地名、瘟疫处理或习俗等公共事实，而当前场景与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动，不提供角色秘密或当前状态。"
    : "";
  const readOnlyTools = hasKnowledge
    ? "look_stage、get_self、observe_actor、query"
    : "look_stage、get_self、observe_actor";

  return `# 当前环境

## 场景
${current.stage.name}
${current.stage.environment}

## 你的状态
${current.actor.name} | HP ${current.actor.stats.hp}/${current.actor.stats.maxHp}

## 同场景角色
${actorLines}

## 场景物品
${itemLines}

## 可交谈对象
${talks}

## 可作用对象
${interactables}

## 可移动至
${moveLines}

# 本轮任务

根据当前环境与自己的记忆决定行动。使用 get_self 查看自己的完整信息，使用 observe_actor 查看同场景目标携带的物品；需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。${knowledgeHint}你能使用的行动工具：${actionList}。本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动；通常一次沟通加一个其他行动，不要重复同一动作。先加入的行动先执行。最后调用 submit_plan 提交。${readOnlyTools} 不占计划。`;
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
 * 已死亡或被玩家接管的 actor 不进入 NPC loop；工具只暴露该 actor 与场景
 * 允许的动作，模型看不到未授权的工具。
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
  if (current.actor.status === "dead") {
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
  const aliveTargets = otherActors
    .filter((actor) => actor.status === "alive")
    .map((actor) => actor.name);
  const selfAndAlive = [current.actor.name, ...aliveTargets];
  const availableAttackItemNames = current.actor.items
    .filter((item) => item.effect.type === "damage")
    .map((item) => item.name);
  const availableUseItemNames = current.actor.items.map((item) => item.name);

  const hasKnowledge = current.actor.actions.includes("query");
  const knowledgeTool = hasKnowledge ? buildKnowledgeTool() : undefined;
  const knowledgeProvider = hasKnowledge
    ? (options.knowledgeProvider ?? new TransformersEmbeddingProvider())
    : undefined;

  const lookTool = buildLookTool(state);
  const selfTool = buildSelfInfoTool();
  const observeTool = buildObserveActorTool(talkTargets);
  const submitTool = buildSubmitPlanTool();

  /** 十个动作的工具与参数解析器；按 kind 平铺，按权限过滤后使用。 */
  const actionTools: Record<ActionKind, ToolDefinition> = {
    say: buildSayTool(talkTargets),
    whisper: buildWhisperTool(talkTargets),
    announce: buildAnnounceTool(),
    move: buildMoveTool(stageNames),
    wait: buildWaitTool(),
    attack: buildAttackTool(aliveTargets, availableAttackItemNames),
    steal: buildStealTool(talkTargets),
    give: buildGiveTool(aliveTargets),
    pickup: buildPickupTool(),
    use: buildUseTool(availableUseItemNames, selfAndAlive, current.stage.name),
  };
  const parsers: Record<ActionKind, (args: Record<string, unknown>) => ActorAction> = {
    say: parseSay,
    whisper: parseWhisper,
    announce: parseAnnounce,
    move: parseMove,
    wait: () => parseWait(),
    attack: parseAttack,
    steal: parseSteal,
    give: parseGive,
    pickup: parsePickup,
    use: parseUse,
  };

  const allowed = allowedActionKinds(current.actor.actions);
  const actions: ActorAction[] = [];
  let submitted: ActorPlan | null = null;

  const ensureOpen = () => {
    if (submitted) {
      throw new GameError("invalid_action", "计划已提交");
    }
  };

  const actionHandlers: Partial<Record<ActionKind, (args: Record<string, unknown>) => string>> =
    Object.fromEntries(
      allowed.map((kind) => [
        kind,
        (args: Record<string, unknown>) => {
          ensureOpen();
          addAction(actions, parsers[kind](args));
          return `${kind} 已加入计划`;
        },
      ]),
    );

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildActorObservation(state, current),
    messages: memory.messages,
    tools: [
      lookTool,
      selfTool,
      observeTool,
      ...(knowledgeTool ? [knowledgeTool] : []),
      ...allowed.map((kind) => actionTools[kind]),
      submitTool,
    ],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [selfTool.function.name]: () => describeSelf(current.actor),
      [observeTool.function.name]: (args) => {
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const target = otherActors.find((actor) => actor.name === targetActorName);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorName}`;
        }
        return describeObservedActor(target);
      },
      ...(knowledgeTool && knowledgeProvider
        ? {
            [knowledgeTool.function.name]: async (args: Record<string, unknown>) => {
              const question = typeof args.question === "string" ? args.question.trim() : "";
              if (question.length === 0) {
                throw new GameError("invalid_action", "question 不能为空");
              }
              const results = await searchDocuments(db, knowledgeProvider, {
                collection: worldCollection(state.world.name, state.game.contentVersion),
                query: question,
                topK: 5,
              });
              return describeKnowledgeResults(question, results);
            },
          }
        : {}),
      ...actionHandlers,
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
  const { ok } = await applyActorPlan(
    db,
    state.game.id,
    current.actor.id,
    submitted,
    newMessages,
    loop.success,
    { service: options.service },
  );

  return {
    ok,
    plan: submitted,
    loopSuccess: loop.success,
    state: await getGameState(db, state.game.id),
  };
}

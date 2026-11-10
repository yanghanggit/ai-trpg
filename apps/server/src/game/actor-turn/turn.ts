import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { createTurnTrace, traceEvent } from "../../debug/trace";
import { DEFAULT_ERROR_RETRIES } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import {
  countCollection,
  DEFAULT_RAG_TOP_K,
  type EmbeddingProvider,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../../rag";
import { findActorByName } from "../actor-state";
import { handleOf } from "../addressing";
import { DEFAULT_ACTOR_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { getGameStateSlice, readTurnDelivery } from "../game-state";
import { isAlive } from "../lookup";
import { loadAgentMemory } from "../memory";
import { isPlayerControlled } from "../persistence/actor-controls";
import {
  describeRoute,
  describeRouteFailure,
  type RouteWorld,
  resolveRouteQuestion,
  routeWorldFromState,
} from "../route";
import { settleActorPlan } from "../settle";
import type { ActorTurnResult } from "../types";
import { actorTurnContext } from "./context";
import { describeNameCollision } from "./identity";
import { createPlanSession } from "./plan-session";
import { renderActorTurnInput } from "./prompt";
import { ACTOR_ACTION_TOOLKITS } from "./toolkit";
import {
  buildActorLookTool,
  buildKnowledgeTool,
  buildRecallRouteTool,
  buildRecognizeIdentityTool,
  buildSelfInfoTool,
  buildSubmitPlanTool,
  buildVisitedStagesTool,
  describeKnowledgeResults,
  describeSelf,
  describeStageForActor,
  describeVisitedStages,
  parseRecallRoute,
  parseRecognizeIdentity,
} from "./tools";

export type ActorTurnOptions = {
  service: ChatCompletionService;
  /** 提交后的推理阶段（换装外观、尸体外观、掉落）需要 LLM；不传则只跑确定性的部分。 */
  inferenceService?: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 真实 RAG provider；所有 actor 都能用 query 检索，测试可注入假 provider。 */
  knowledgeProvider?: EmbeddingProvider;
  /** 覆盖 TRPG_AUDIT_NAMES；测试用来打开回合级名字审计。 */
  auditNameLeaks?: boolean;
};

/**
 * 一个 actor 的一轮：读状态、让模型读与写、提交计划，最后落账。
 *
 * 「actor」而不是「NPC」：引擎不区分谁在玩，只区分这一轮是不是由模型决策
 * （玩家接管的 actor 走玩家动作入口）。回合的这一侧与 stage / world 对称。
 */
export async function runActorTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: ActorTurnOptions,
): Promise<ActorTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const current = findActorByName(state, actorRef);
  if (!isAlive(current.actor)) {
    throw new GameError("invalid_action", `actor 已死亡: ${current.actor.name}`);
  }
  if (await isPlayerControlled(db, state.game.id, current.actor.id)) {
    throw new GameError("invalid_action", `actor 已被玩家接管: ${current.actor.name}`);
  }

  const memory = await loadAgentMemory(db, state.game.id, "actor", current.actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
  }
  const maxRounds = options.maxRounds ?? DEFAULT_ACTOR_MAX_ROUNDS;

  const trace = createTurnTrace({ game: state.game, turnKind: "actor" });
  await traceEvent(trace, {
    event: "turn_start",
    label: current.actor.name,
    actorId: current.actor.id,
    actorName: current.actor.name,
    stageId: current.stage.id,
    stageName: current.stage.name,
    contentVersion: state.game.contentVersion,
  });

  const context = actorTurnContext(state, current);
  const session = createPlanSession();
  // 落账与推理共用同一份可选参数；`exactOptionalPropertyTypes` 下只能逐项挑出有值的，
  // 所以先组装一次，避免两处各写一串三元展开而漏掉某一项。
  const optional = {
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
    ...(options.auditNameLeaks === undefined ? {} : { auditNameLeaks: options.auditNameLeaks }),
  };

  // 公共知识库检索是所有 actor 都能用的只读工具，不按角色开关。
  const knowledgeTool = buildKnowledgeTool();
  // 真实 provider 由调用方注入假实现覆盖：检索是只读工具，不按角色开关。
  const knowledgeProvider = options.knowledgeProvider ?? new TransformersEmbeddingProvider();
  const lookTool = buildActorLookTool();
  const selfTool = buildSelfInfoTool();
  const visitedStagesTool = buildVisitedStagesTool();
  const routeTool = buildRecallRouteTool();
  // 编号始终可见：既能给新签名起名，也能对已有名字重新记录来更新称呼。
  const recognizeTool = buildRecognizeIdentityTool(
    context.others.map((actor) => handleOf(actor.signature.seq)),
  );
  const submitTool = buildSubmitPlanTool();

  let routeWorld: RouteWorld | undefined;
  const routeWorldOnce = () => (routeWorld ??= routeWorldFromState(state, current));

  const actionHandlers = Object.fromEntries(
    context.allowed.map((kind) => [
      kind,
      (args: Record<string, unknown>) => {
        session.addAction(ACTOR_ACTION_TOOLKITS[kind].parse(args));
        return `${kind} 已加入计划`;
      },
    ]),
  );

  const addIdentity = (args: Record<string, unknown>) => {
    const binding = parseRecognizeIdentity(args);
    const note = describeNameCollision({
      state,
      current,
      pending: session.identities,
      binding,
    });
    // 同一个编号重复记时后一次覆盖前一次：既不重复写记忆，也不用额外条数上限。
    const outcome = session.addIdentity(binding);
    return outcome === "updated"
      ? `${binding.handle} 的名字已更新${note}`
      : `名字已加入计划${note}`;
  };

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: renderActorTurnInput(context, maxRounds),
    messages: memory.messages,
    tools: [
      lookTool,
      selfTool,
      visitedStagesTool,
      routeTool,
      knowledgeTool,
      recognizeTool,
      ...context.allowed.map((kind) => ACTOR_ACTION_TOOLKITS[kind].build(context)),
      submitTool,
    ],
    handlers: {
      [lookTool.function.name]: () => describeStageForActor(state, current),
      [selfTool.function.name]: () => describeSelf(current.actor),
      [visitedStagesTool.function.name]: () =>
        describeVisitedStages(state, current.actor.id, current.stage.id),
      [knowledgeTool.function.name]: async (args: Record<string, unknown>) => {
        const keywords = typeof args.keywords === "string" ? args.keywords.trim() : "";
        if (keywords.length === 0) {
          throw new GameError("invalid_action", "keywords 不能为空");
        }
        // collection 为空 = 这个世界没入库（或换了内容版本），与“查得到但没这条”区分开，
        // 免得把空结果当成事实不存在。
        const collection = worldCollection(state.world.contentKey, state.game.contentVersion);
        const results = await searchDocuments(db, knowledgeProvider, {
          collection,
          query: keywords,
          topK: DEFAULT_RAG_TOP_K,
        });
        if (results.length === 0 && (await countCollection(db, collection)) === 0) {
          return `# 公共知识检索\n检索词：${keywords}\n（这个世界没有可检索的公共知识）`;
        }
        return describeKnowledgeResults(keywords, results);
      },
      ...actionHandlers,
      [routeTool.function.name]: (args) => {
        const resolution = resolveRouteQuestion(state, current, parseRecallRoute(args));
        if (!resolution.ok) {
          // 失败的回忆也要进认知：同一轮内同一句问题只记一次。
          session.noteRouteFailure(resolution.failure);
          return `# 路线\n${describeRouteFailure(routeWorldOnce(), resolution.failure)}`;
        }
        // 一轮里同一条问题只记一次：重复调用只回话，不重复写记忆。
        session.noteRoute(resolution.query);
        return `# 路线\n${describeRoute(routeWorldOnce(), resolution.query)}`;
      },
      [recognizeTool.function.name]: (args) => addIdentity(args),
      [submitTool.function.name]: () => {
        session.submit();
        return "计划已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds,
    finalRoundHint:
      "# 最后一轮\n这是本回合最后一次推理机会，本次回复之后本轮结束。已决定做什么，就在这次回复里同时调用动作工具与 submit_plan；仍需信息就在这次回复里一并调完只读工具并立即提交，不要再留到下一轮。",
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...optional,
  });

  // 轮次用尽或模型忘记终结时，退回最后一次快照，让已暂存的动作照常落账。
  const plan = session.plan;
  const applied = await settleActorPlan(db, state.game.id, current.actor.id, plan, loop.success, {
    service: options.service,
    ...(options.inferenceService ? { inferenceService: options.inferenceService } : {}),
    ...optional,
  });
  await traceEvent(trace, {
    event: "turn_end",
    ok: applied.ok,
    loopSuccess: loop.success,
    ...(applied.death ? { detail: applied.death } : {}),
  });

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok: applied.ok,
    plan,
    loopSuccess: loop.success,
    ...(applied.death ? { death: applied.death } : {}),
  };
}

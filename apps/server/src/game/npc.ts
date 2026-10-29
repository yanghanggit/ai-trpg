import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { createTurnTrace, traceEvent } from "../debug/trace";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import {
  countCollection,
  DEFAULT_RAG_TOP_K,
  type EmbeddingProvider,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../rag";
import { ACTION_SUMMARIES, allowedActionKinds } from "./actions";
import { buildAnnounceTool, parseAnnounce } from "./actions/announce";
import { buildBrawlTool, parseBrawl } from "./actions/brawl";
import { buildEquipTool, parseEquip } from "./actions/equip";
import { buildGiveTool, parseGive } from "./actions/give";
import { buildMoveTool, parseMove } from "./actions/move";
import { buildPickupTool, parsePickup } from "./actions/pickup";
import { buildSayTool, parseSay } from "./actions/say";
import { buildStealTool, parseSteal } from "./actions/steal";
import { buildStrikeTool, parseStrike } from "./actions/strike";
import { buildTeleportTool, parseTeleport } from "./actions/teleport";
import { buildUnequipTool, parseUnequip } from "./actions/unequip";
import { buildUseTool, parseUse, usableItemNames } from "./actions/use";
import { buildWaitTool, parseWait } from "./actions/wait";
import { buildWhisperTool, parseWhisper } from "./actions/whisper";
import {
  type ActorWithStage,
  adjacentStageNames,
  findActorWithStage,
  otherActorsInStage,
} from "./actors";
import { addressLookupFor, refOf } from "./addressing";
import { applyActorPlan } from "./apply";
import { isAlive } from "./apply/queries";
import {
  DEFAULT_LLM_ERROR_RETRIES,
  DEFAULT_NPC_MAX_ROUNDS,
  MAX_ACTIONS_PER_TURN,
} from "./constants";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { equippedItemActions, isWearable } from "./items";
import { loadAgentMemory } from "./memory";
import {
  buildActorLookTool,
  buildKnowledgeTool,
  buildObserveActorTool,
  buildRememberIdentityTool,
  buildSelfInfoTool,
  buildSubmitPlanTool,
  describeKnowledgeResults,
  describeObservedActor,
  describeSelf,
  describeStageForActor,
  parseRememberIdentity,
  renderStageEnvironmentForActor,
} from "./plan";
import { getGameState } from "./service";
import { teleportTargetsFor } from "./teleport";
import type { ActionKind, ActorAction, ActorPlan, ActorTurnResult, GameState } from "./types";
import { EQUIPMENT_SLOTS } from "./types";

export type NpcTurnOptions = {
  service: ChatCompletionService;
  /** 死亡阶段的外观快照；不传则死者外观留到显式调用。 */
  appearanceService?: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 真实 RAG provider；所有 actor 都能用 query 检索，测试可注入假 provider。 */
  knowledgeProvider?: EmbeddingProvider;
};

/** 构造 actor 本轮的公开环境与任务说明；NPC 与探针共用。 */
export function buildActorTurnInput(state: GameState, current: ActorWithStage): string {
  const moves = adjacentStageNames(state, current.stage.id);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const address = addressLookupFor(state, current.actor, current.stage);
  const selfHandle = address(current.actor.id).token;
  const targets = others.map((actor) => address(actor.id).token);
  const allowed = allowedActionKinds(current.actor.actions, equippedItemActions(current.actor));
  const actionList = allowed.map((kind) => `${kind}（${ACTION_SUMMARIES[kind]}）`).join("、");
  const actorLines =
    others.length === 0
      ? "无"
      : others
          .map((actor) => `${refOf(address(actor.id))}${isAlive(actor) ? "" : "（已死亡）"}`)
          .join("\n");
  const itemLines =
    current.stage.items.length === 0
      ? "无"
      : current.stage.items
          .map((item) => `${item.name}（${item.kind}）：${item.description}`)
          .join("\n");
  const targetLines = targets.length === 0 ? "无" : targets.join("、");
  const moveLines = moves.length === 0 ? "无" : moves.map((name) => `@${name}`).join("、");
  const canTeleport = current.actor.actions.includes("teleport");
  const teleportTargets = teleportTargetsFor(state, current.actor, current.stage);
  const teleportLines =
    teleportTargets.length === 0
      ? "无"
      : teleportTargets.map((stage) => `@${stage.name}`).join("、");
  const knowledgeHint =
    "当问题涉及任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实，而当前场景与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动，不提供角色秘密或当前状态。";
  // 只有名单里还有 `#编号` 时才提醒记名字：此时 remember_identity 才有对象可记。
  const unknownTargets = targets.filter((token) => token.startsWith("#"));
  const identityHint =
    "`@名字` 与 `#编号` 都可作为行动对象，但都不能说出口，也不能从 `#编号` 推断姓名。名字只有在世界内被告知后才算知道。" +
    (unknownTargets.length === 0
      ? ""
      : "名单里还有 `#编号`：如果你已经从对话或记载中知道其中某人的名字，用 remember_identity 记下（不占行动名额）。");

  return `# 当前环境

## 场景
${current.stage.name}
${renderStageEnvironmentForActor(state, current.stage, current)}

## 你的状态
${current.actor.name}（你的引用：${selfHandle}）| HP ${current.actor.hp}/${current.actor.stats.maxHp}

## 同场景角色
${actorLines}

## 场景物品
${itemLines}

## 可作用对象
${targetLines}

## 可移动至
${moveLines}
${
  canTeleport
    ? `
## 可传送至（已去过且未禁传）
${teleportLines}`
    : ""
}

# 本轮任务

根据当前环境与自己的记忆决定行动。使用 get_self 查看自己的完整信息，使用 observe_actor 查看同场景目标携带的物品；需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。${knowledgeHint}${identityHint}你能使用的行动工具：${actionList}。本轮只能提交 ${MAX_ACTIONS_PER_TURN} 个行动：说话、移动、动手都各占一个回合，需要连着做就分几个回合。最后调用 submit_plan 提交。look_stage、get_self、observe_actor、query、remember_identity 不占计划。look_stage 只能看本场景。`;
}

/** 把动作加入本轮计划；条数上限在这里就告诉模型，避免提交后才被拒绝。 */
function addAction(actions: ActorAction[], action: ActorAction): void {
  if (actions.length >= MAX_ACTIONS_PER_TURN) {
    throw new GameError(
      "invalid_action",
      `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动；需要连着做多个动作时，请分几个回合`,
    );
  }
  actions.push(action);
}

/** 已死亡或被玩家接管的 actor 进不来。 */
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

  const stageNames = adjacentStageNames(state, current.stage.id);
  const otherActors = otherActorsInStage(current.stage, current.actor.id);
  const address = addressLookupFor(state, current.actor, current.stage);
  // 目标不区分存活：唯一的存活要求是行动者自己，由行动入口统一把关。
  const targets = otherActors.map((actor) => address(actor.id).token);
  const selfAndTargets = [address(current.actor.id).token, ...targets];
  // 材料之类的惰性物品没有可用效果，穿戴中的物品也不能当道具，两者都不列进 use 的候选。
  const availableUseItemNames = usableItemNames(current.actor.items, current.actor.equipment);
  const wearableItemNames = current.actor.items.filter(isWearable).map((item) => item.name);
  const occupiedSlots = EQUIPMENT_SLOTS.filter(
    (slot) => current.actor.equipment[slot] !== undefined,
  );

  // 公共知识库检索是所有 actor 都能用的只读工具，不按角色开关。
  const knowledgeTool = buildKnowledgeTool();
  const knowledgeProvider = options.knowledgeProvider ?? new TransformersEmbeddingProvider();

  const teleportTargets = teleportTargetsFor(state, current.actor, current.stage).map(
    (stage) => stage.name,
  );
  const lookTool = buildActorLookTool(current.stage.name);
  const selfTool = buildSelfInfoTool();
  const observeTool = buildObserveActorTool(targets);
  // 只能给「还不知道名字」的角色记称呼：已经知道的引用不需要再记。
  const rememberTool = buildRememberIdentityTool(targets.filter((token) => token.startsWith("#")));
  const submitTool = buildSubmitPlanTool();

  /** 十二个动作的工具与参数解析器；按 kind 平铺，按权限过滤后使用。 */
  const actionTools: Record<ActionKind, ToolDefinition> = {
    say: buildSayTool(targets),
    whisper: buildWhisperTool(targets),
    announce: buildAnnounceTool(),
    move: buildMoveTool(stageNames.map((name) => `@${name}`)),
    teleport: buildTeleportTool(teleportTargets.map((name) => `@${name}`)),
    wait: buildWaitTool(),
    strike: buildStrikeTool(targets),
    brawl: buildBrawlTool(targets),
    steal: buildStealTool(targets),
    give: buildGiveTool(targets),
    pickup: buildPickupTool(),
    use: buildUseTool(availableUseItemNames, selfAndTargets, `@${current.stage.name}`),
    equip: buildEquipTool(wearableItemNames),
    unequip: buildUnequipTool(occupiedSlots),
  };
  const parsers: Record<ActionKind, (args: Record<string, unknown>) => ActorAction> = {
    say: parseSay,
    whisper: parseWhisper,
    announce: parseAnnounce,
    move: parseMove,
    teleport: parseTeleport,
    wait: () => parseWait(),
    strike: parseStrike,
    brawl: parseBrawl,
    steal: parseSteal,
    give: parseGive,
    pickup: parsePickup,
    use: parseUse,
    equip: parseEquip,
    unequip: parseUnequip,
  };

  const allowed = allowedActionKinds(current.actor.actions, equippedItemActions(current.actor));
  const actions: ActorAction[] = [];
  const identities: { handle: string; name: string }[] = [];
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

  const addIdentity = (args: Record<string, unknown>) => {
    ensureOpen();
    const binding = parseRememberIdentity(args);
    // 同一个编号重复记时后一次覆盖前一次：既不重复写记忆，也不用额外条数上限。
    const known = identities.find((existing) => existing.handle === binding.handle);
    if (known) {
      known.name = binding.name;
      return `${binding.handle} 的称呼已更新`;
    }
    identities.push(binding);
    return "名字已加入计划";
  };

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildActorTurnInput(state, current),
    messages: memory.messages,
    tools: [
      lookTool,
      selfTool,
      observeTool,
      knowledgeTool,
      rememberTool,
      ...allowed.map((kind) => actionTools[kind]),
      submitTool,
    ],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return describeStageForActor(state, stageName, current);
      },
      [selfTool.function.name]: () => describeSelf(current.actor),
      [observeTool.function.name]: (args) => {
        const targetActorRef =
          typeof args.targetActorRef === "string" ? args.targetActorRef.trim() : "";
        const target = otherActors.find((actor) => address(actor.id).token === targetActorRef);
        if (!target) {
          return `错误：当前场景内找不到引用 ${targetActorRef}`;
        }
        return describeObservedActor(target, address);
      },
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
      [rememberTool.function.name]: (args) => addIdentity(args),
      [submitTool.function.name]: () => {
        if (actions.length === 0 && identities.length === 0) {
          throw new GameError("invalid_action", "计划中没有行动");
        }
        submitted = {
          actions: actions.map((action) => ({ ...action })),
          ...(identities.length > 0 ? { identities: identities.map((item) => ({ ...item })) } : {}),
        };
        return "计划已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_NPC_MAX_ROUNDS,
    errorRetries: DEFAULT_LLM_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
  });

  const applied = await applyActorPlan(
    db,
    state.game.id,
    current.actor.id,
    submitted,
    loop.success,
    {
      service: options.service,
      ...(options.appearanceService ? { appearanceService: options.appearanceService } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      ...(trace ? { trace } : {}),
    },
  );
  await traceEvent(trace, {
    event: "turn_end",
    ok: applied.ok,
    loopSuccess: loop.success,
    ...(applied.death ? { detail: applied.death } : {}),
  });

  return {
    ok: applied.ok,
    plan: submitted,
    loopSuccess: loop.success,
    state: await getGameState(db, state.game.id),
    ...(applied.death ? { death: applied.death } : {}),
    ...(applied.identityWarnings ? { identityWarnings: applied.identityWarnings } : {}),
  };
}

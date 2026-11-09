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
import { buildCallTool, parseCall } from "./actions/call";
import { buildCleaveTool, parseCleave } from "./actions/cleave";
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
import { type ActorWithStage, findActorByName, otherActorsInStage } from "./actors";
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
import { carriedActionCap, equippedItemActions, isWearable } from "./items";
import { loadAgentMemory } from "./memory";
import {
  adjacentStageRefsForActor,
  buildActorLookTool,
  buildKnowledgeTool,
  buildObserveActorTool,
  buildRecallRouteTool,
  buildRecognizeIdentityTool,
  buildSelfInfoTool,
  buildSubmitPlanTool,
  buildVisitedStagesTool,
  describeEquipmentBrief,
  describeKnowledgeResults,
  describeObservedActor,
  describeSelf,
  describeStageAnchors,
  describeStageForActor,
  describeVisitedStages,
  parseRecallRoute,
  parseRecognizeIdentity,
  renderStageEnvironmentForActor,
  sealedVisitedStageRefsForActor,
  stageItemNames,
} from "./plan";
import { getGameStateSlice, readTurnDelivery } from "./read/game-state";
import { handleOf, isHandleRef } from "./reference";
import {
  describeRoute,
  describeRouteFailure,
  type RouteWorld,
  resolveRouteQuestion,
  routeWorldFromState,
} from "./route";
import { visitedTeleportTargetsFor } from "./teleport";
import type {
  ActionKind,
  ActorAction,
  ActorPlan,
  ActorState,
  ActorTurnResult,
  GameStateSlice,
  RouteFailure,
  RouteQuery,
} from "./types";
import { EQUIPMENT_SLOTS } from "./types";

export type NpcTurnOptions = {
  service: ChatCompletionService;
  /** 死亡阶段的外观快照；不传则死者外观留到显式调用。 */
  appearanceService?: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 真实 RAG provider；所有 actor 都能用 query 检索，测试可注入假 provider。 */
  knowledgeProvider?: EmbeddingProvider;
  /** 覆盖 TRPG_AUDIT_NAMES；测试用来打开回合级名字审计。 */
  auditNameLeaks?: boolean;
};

/**
 * 侦察（`observe_actor`）是偷窃的前置：只有能 `steal` 的角色才注入这个工具。
 * 工具注入与任务提示词共用这一条判断，避免提示词提到不存在的工具。
 */
function canObserveActorItems(actor: Pick<ActorState, "actions">): boolean {
  return actor.actions.includes("steal");
}

/** 构造 actor 本轮的公开环境与任务说明；NPC 与探针共用。 */
export function buildActorTurnInput(state: GameStateSlice, current: ActorWithStage): string {
  const moves = adjacentStageRefsForActor(state, current);
  // 去过、但现在封着的出口：记忆里的一道门。它不能走，只是认得出来。
  const remembered = sealedVisitedStageRefsForActor(state, current);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const address = addressLookupFor(state, current.actor, current.stage);
  const selfHandle = address(current.actor.id).token;
  const targets = others.map((actor) => address(actor.id).token);
  const allowed = allowedActionKinds(current.actor.actions, equippedItemActions(current.actor));
  const actionList = allowed.map((kind) => `${kind}（${ACTION_SUMMARIES[kind]}）`).join("、");
  // 已穿戴物品不能 use 是动作自身的约束；用哪个动作替代属于流程，放在任务提示词。
  // 武器的两种攻击是平级的（单体挥击 / 横扫），提示词只列本次真的能用的那个。
  const weaponAttackKinds = (["strike", "cleave"] as const).filter((kind) =>
    allowed.includes(kind),
  );
  const useAlternatives = [
    ...(weaponAttackKinds.length > 0 ? [`武器用 ${weaponAttackKinds.join(" 或 ")}`] : []),
    ...(allowed.includes("unequip")
      ? [weaponAttackKinds.length > 0 ? "其余先 unequip" : "先 unequip"]
      : []),
  ];
  const useFlowHint = allowed.includes("use")
    ? `已穿戴的物品不能用 use${useAlternatives.length > 0 ? `；${useAlternatives.join("；")}` : ""}。`
    : "";
  const callHint = allowed.includes("call")
    ? "传音不会自动暴露你是谁；想让对方知道，就把自称写进 message。"
    : "";
  // 攻击是能力面：引擎不自动授予 brawl，没武器时能用什么完全由角色固有声明决定。
  // 这里只把“现在到底有没有出手方式”说清楚，避免模型反复尝试没有的动作。
  const unarmedHint =
    weaponAttackKinds.length > 0
      ? ""
      : allowed.includes("brawl")
        ? "当前没有能出手的武器：近战只能用 brawl（身体攻击，不吃武器数值）。"
        : "当前既没有能出手的武器，也没有 brawl：本轮无法发起攻击。";
  // 侦察与偷窃同生共死：不偷东西的角色只看姓名与穿戴，不提供背包细节。
  const canObserve = canObserveActorItems(current.actor);
  const toolHint = canObserve
    ? "使用 get_self 查看自己的完整信息，使用 observe_actor 查看同场景目标背包里的全部物品（含未穿戴的）；"
    : "使用 get_self 查看自己的完整信息；";
  const readOnlyHint = `${[
    "look_stage",
    "get_self",
    ...(canObserve ? ["observe_actor"] : []),
    "get_visited_stages",
    "recall_route",
    "query",
    "recognize_identity",
  ].join(
    "、",
  )} 不占计划。look_stage 只能看本场景；get_visited_stages 可以回看你走过的场景；recall_route 顺着场景连接回一条路线，结论会进你的认知（地名写错时会记成「无法寻路」）。`;
  const actorLines =
    others.length === 0
      ? "无"
      : others
          .map((actor) => {
            const worn = describeEquipmentBrief(actor);
            const dead = isAlive(actor) ? "" : "（已死亡）";
            return `${refOf(address(actor.id))}${dead}${worn.length === 0 ? "" : `｜${worn}`}`;
          })
          .join("\n");
  const anchorLines = describeStageAnchors(current.stage.anchors);
  const targetLines = targets.length === 0 ? "无" : targets.join("、");
  const moveLines = moves.length === 0 ? "无" : moves.join("、");
  const canTeleport = current.actor.actions.includes("teleport");
  const teleportTargets = visitedTeleportTargetsFor(state, current.actor, current.stage);
  const teleportLines =
    teleportTargets.length === 0 ? "无" : teleportTargets.map((stage) => stage.name).join("、");
  const knowledgeHint =
    "当问题涉及任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实，而当前场景与记忆无法直接确认时，必须先调用 query 检索，再回答或行动；不要用常识补全，也不要把检索结果当成亲眼所见。query 只读、不占行动，不提供角色秘密或当前状态。";
  // 只有名单里还有 `#编号` 时才提醒起名；已有名字也可以按 # 重新记录来更新称呼。
  const unknownTargets = targets.filter(isHandleRef);
  const identityHint =
    "行动对象写你对它的称呼（名单里的名字）；还不知道名字、或者两个人同名时写 `#编号`。编号是系统占位，绝不能说出口。use 的 targetAnchor 只能从当前场景的「可交互锚点」里选，不能自己写位置描述。" +
    (unknownTargets.length === 0
      ? ""
      : "名单里还有 `#编号`：可以用 recognize_identity 把它记成你认得的称呼；需要改名时对同一个编号再记一次（不占行动名额）。");

  return `# 当前环境

## 场景
${current.stage.name}
${renderStageEnvironmentForActor(state, current)}

## 你的状态
${current.actor.name}（你的引用：${selfHandle}）| HP ${current.actor.hp}/${current.actor.stats.maxHp}

## 同场景角色
${actorLines}

## 可交互锚点
${anchorLines}

## 可作用对象
${targetLines}

## 可移动至
${moveLines}${
  remembered.length === 0
    ? ""
    : `\n\n## 记得封着的出口（认得出，但过不去）
${remembered.join("、")}`
}
${
  canTeleport
    ? `
## 可传送（写对真名即可；下列是去过的、未禁传的）
${teleportLines}`
    : ""
}

# 本轮任务

根据当前环境与自己的记忆决定行动。名单里已列出同场景他人身上穿戴的装备；${toolHint}需要多项信息时，可以一次返回多个只读工具调用，也可以分多轮调用。${knowledgeHint}${identityHint}你能使用的行动工具：${actionList}。${useFlowHint}${callHint}${unarmedHint}本轮只能提交 ${MAX_ACTIONS_PER_TURN} 个行动：说话、移动、动手都各占一个回合，需要连着做就分几个回合。最后调用 submit_plan 提交。${readOnlyHint}`;
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

  const stageRefs = adjacentStageRefsForActor(state, current);
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

  const lookTool = buildActorLookTool();
  const selfTool = buildSelfInfoTool();
  const visitedStagesTool = buildVisitedStagesTool();
  const routeTool = buildRecallRouteTool();
  // 侦察是偷窃的前置：只有能 steal 的角色才注入 observe_actor，与任务提示词同一判断。
  const observeTool = canObserveActorItems(current.actor)
    ? buildObserveActorTool(targets)
    : undefined;
  // 编号始终可见：既能给新签名起名，也能对已有名字重新记录来更新称呼。
  const recognizeTool = buildRecognizeIdentityTool(
    otherActors.map((actor) => handleOf(actor.signature.seq)),
  );
  const submitTool = buildSubmitPlanTool();
  // 横扫的目标上限属于携带者：工具形状按当前穿戴的武器给，没武器时回落到 1（也就不会授权）。
  const cleaveMaxTargets = carriedActionCap(current.actor, "cleave");

  /** 十二个动作的工具与参数解析器；按 kind 平铺，按权限过滤后使用。 */
  const actionTools: Record<ActionKind, ToolDefinition> = {
    say: buildSayTool(targets),
    whisper: buildWhisperTool(targets),
    announce: buildAnnounceTool(),
    call: buildCallTool(),
    move: buildMoveTool(stageRefs),
    teleport: buildTeleportTool(),
    wait: buildWaitTool(),
    strike: buildStrikeTool(targets),
    cleave: buildCleaveTool(targets, cleaveMaxTargets),
    brawl: buildBrawlTool(targets),
    steal: buildStealTool(targets),
    give: buildGiveTool(targets),
    pickup: buildPickupTool(
      current.stage.anchors.map((anchor) => anchor.label),
      stageItemNames(current.stage),
    ),
    use: buildUseTool(
      availableUseItemNames,
      selfAndTargets,
      current.stage.name,
      current.stage.anchors.map((anchor) => anchor.label),
    ),
    equip: buildEquipTool(wearableItemNames),
    unequip: buildUnequipTool(occupiedSlots),
  };
  const parsers: Record<ActionKind, (args: Record<string, unknown>) => ActorAction> = {
    say: parseSay,
    whisper: parseWhisper,
    announce: parseAnnounce,
    call: parseCall,
    move: parseMove,
    teleport: parseTeleport,
    wait: () => parseWait(),
    strike: parseStrike,
    cleave: parseCleave,
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
  const routes: RouteQuery[] = [];
  const routeFailures: RouteFailure[] = [];
  let routeWorld: RouteWorld | undefined;
  const routeWorldOnce = () => (routeWorld ??= routeWorldFromState(state, current));
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

  /**
   * 同名不阻止，只回话。
   *
   * 名字是认知，重名是合法状态（两个卫兵我都叫「卫兵」）；但两个同形地址无法指认，
   * 渲染时它们都会退回 `#编号`。这里只把这件事讲清楚，让模型当回合就能决定
   * 「换个称呼」还是「以后用编号」——不替它决定，也不污染它的认知。
   */
  const describeNameCollision = (binding: { handle: string; name: string }): string => {
    const observerNames = new Map(
      state.signatureNames
        .filter((row) => row.observerActorId === current.actor.id)
        .map((row) => [row.signatureId, row.name] as const),
    );
    const handleToActor = new Map(
      current.stage.actors.map((actor) => [handleOf(actor.signature.seq), actor] as const),
    );
    const target = handleToActor.get(binding.handle);
    const clashes: string[] = [];
    if (binding.name === current.actor.name) {
      clashes.push(`「${binding.name}」是你自己的真名`);
    }
    for (const actor of current.stage.actors) {
      if (actor.id === target?.id || actor.id === current.actor.id) {
        continue;
      }
      if (observerNames.get(actor.signature.id) === binding.name) {
        clashes.push(handleOf(actor.signature.seq));
      }
    }
    for (const pending of identities) {
      if (pending.handle !== binding.handle && pending.name === binding.name) {
        clashes.push(pending.handle);
      }
    }
    if (clashes.length === 0) {
      return "";
    }
    const who = [...new Set(clashes)].join("、");
    return `\n注意：${who} 也叫「${binding.name}」。同名会让地址退回编号，行动时用 #编号 指认；想用名字指认就给其中一个换个称呼。`;
  };

  const addIdentity = (args: Record<string, unknown>) => {
    ensureOpen();
    const binding = parseRecognizeIdentity(args);
    const note = describeNameCollision(binding);
    // 同一个编号重复记时后一次覆盖前一次：既不重复写记忆，也不用额外条数上限。
    const known = identities.find((existing) => existing.handle === binding.handle);
    if (known) {
      known.name = binding.name;
      return `${binding.handle} 的名字已更新${note}`;
    }
    identities.push(binding);
    return `名字已加入计划${note}`;
  };

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildActorTurnInput(state, current),
    messages: memory.messages,
    tools: [
      lookTool,
      selfTool,
      visitedStagesTool,
      routeTool,
      ...(observeTool ? [observeTool] : []),
      knowledgeTool,
      recognizeTool,
      ...allowed.map((kind) => actionTools[kind]),
      submitTool,
    ],
    handlers: {
      [lookTool.function.name]: () => describeStageForActor(state, current),
      [selfTool.function.name]: () => describeSelf(current.actor),
      [visitedStagesTool.function.name]: () =>
        describeVisitedStages(state, current.actor.id, current.stage.id),
      ...(observeTool
        ? {
            [observeTool.function.name]: (args: Record<string, unknown>) => {
              const targetActorRef =
                typeof args.targetActorRef === "string" ? args.targetActorRef.trim() : "";
              const target = otherActors.find(
                (actor) => address(actor.id).token === targetActorRef,
              );
              if (!target) {
                return `错误：当前场景内找不到引用 ${targetActorRef}`;
              }
              return describeObservedActor(target, address);
            },
          }
        : {}),
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
        ensureOpen();
        const resolution = resolveRouteQuestion(state, current, parseRecallRoute(args));
        if (!resolution.ok) {
          // 失败的回忆也要进认知：同一轮内同一句问题只记一次。
          const { failure } = resolution;
          const duplicate = routeFailures.some(
            (item) =>
              item.toStageRef === failure.toStageRef &&
              item.fromStageId === failure.fromStageId &&
              item.fromStageRef === failure.fromStageRef,
          );
          if (!duplicate) {
            routeFailures.push(failure);
          }
          return `# 路线\n${describeRouteFailure(routeWorldOnce(), failure)}`;
        }
        const { query } = resolution;
        // 一轮里同一条问题只记一次：重复调用只回话，不重复写记忆。
        const duplicate = routes.some(
          (item) => item.fromStageId === query.fromStageId && item.toStageId === query.toStageId,
        );
        if (!duplicate) {
          routes.push(query);
        }
        return `# 路线\n${describeRoute(routeWorldOnce(), query)}`;
      },
      [recognizeTool.function.name]: (args) => addIdentity(args),
      [submitTool.function.name]: () => {
        if (
          actions.length === 0 &&
          identities.length === 0 &&
          routes.length === 0 &&
          routeFailures.length === 0
        ) {
          throw new GameError("invalid_action", "计划中没有行动");
        }
        submitted = {
          actions: actions.map((action) => ({ ...action })),
          ...(identities.length > 0 ? { identities: identities.map((item) => ({ ...item })) } : {}),
          ...(routes.length > 0 ? { routes: routes.map((item) => ({ ...item })) } : {}),
          ...(routeFailures.length > 0
            ? { routeFailures: routeFailures.map((item) => ({ ...item })) }
            : {}),
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
      ...(options.auditNameLeaks === undefined ? {} : { auditNameLeaks: options.auditNameLeaks }),
    },
  );
  await traceEvent(trace, {
    event: "turn_end",
    ok: applied.ok,
    loopSuccess: loop.success,
    ...(applied.death ? { detail: applied.death } : {}),
  });

  return {
    ...(await readTurnDelivery(db, state.game.id)),
    ok: applied.ok,
    plan: submitted,
    loopSuccess: loop.success,
    ...(applied.death ? { death: applied.death } : {}),
  };
}

import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import type { ActorTurnContext } from "../agents/actor-turn/context";
import type { AffixRequest } from "../agents/affixes";
import type { StaticSettlement } from "../agents/affixes/static";
import type { StaticOutcome } from "../agents/affixes/types";
import { GameError } from "../errors";
import type { AddressLookup } from "../kernel/addressing";
import { assertNoSystemReference } from "../kernel/addressing";
import { agentAffixes } from "../kernel/affixes";
import type { ActionKind, ActorAction, AffixTriggers } from "../kernel/types";
import type {
  ActorRow,
  ActorWithStageRow,
  Executor,
  StageRow,
  WorldRow,
} from "../persistence/rows";
import type { ResolvedAction } from "../settle/types";
import { stageItemNames } from "../stage-state/describe";

import { applyAnnounce, buildAnnounceTool, parseAnnounce } from "./announce";
import { applyBrawl, buildBrawlTool, parseBrawl, resolveBrawl } from "./brawl";
import { applyCall, buildCallTool, parseCall, resolveCall } from "./call";
import { applyCleave, buildCleaveTool, parseCleave, resolveCleave } from "./cleave";
import { applyEquip, buildEquipTool, parseEquip, resolveEquip } from "./equip";
import { applyFit, buildFitTool, parseFit, resolveFit } from "./fit";
import { applyGive, buildGiveTool, parseGive, resolveGive } from "./give";
import { applyInspect, buildInspectTool, parseInspect, resolveInspect } from "./inspect";
import { applyLoot, buildLootTool, parseLoot, resolveLoot } from "./loot";
import { applyMove, buildMoveTool, parseMove, resolveMove } from "./move";
import { applyPickup, buildPickupTool, parsePickup, resolvePickup } from "./pickup";
import { applySay, buildSayTool, parseSay, resolveSay } from "./say";
import { applySteal, buildStealTool, parseSteal, resolveSteal } from "./steal";
import { applyStrike, buildStrikeTool, parseStrike, resolveStrike } from "./strike";
import { applyTeleport, buildTeleportTool, parseTeleport, resolveTeleport } from "./teleport";
import { applyUnequip, buildUnequipTool, parseUnequip, resolveUnequip } from "./unequip";
import { applyUse, buildUseTool, parseUse, resolveUse } from "./use";
import { applyWait, buildWaitTool, parseWait, resolveWait } from "./wait";
import { applyWhisper, buildWhisperTool, parseWhisper, resolveWhisper } from "./whisper";

/**
 * 动作调度表：一个动作一行，把「工具形状、参数解析、解析、落账」放在同一处。
 *
 * 调度只查表——授权、解析、落账与词缀请求都不按动作名写分支。具体怎么结算仍由各自的
 * `apply*` 实现，穷举只允许发生在那一层；新增动作在这里补一行，漏写就是编译错误。
 */
export type ResolveContext = {
  executor: Executor;
  world: WorldRow;
  actorRow: ActorWithStageRow;
  /** 解析期此刻的舞台：位移动作会把它改成目标舞台。 */
  stage: StageRow;
  /** 把引用解析成本舞台内可见角色。 */
  visible: (ref: string) => Promise<ActorRow>;
};

/** 落账期共享的写入上下文；具体动作只取自己需要的部分。 */
export type ApplyContext = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  now: Date;
  address: AddressLookup;
  trace?: TraceContext;
};

/** 一次动作落账的结果；带词缀的动作额外交回静态结果，供增量阶段使用。 */
export type ActionResult = {
  feedback: string;
  staticSettlement?: StaticSettlement;
  staticOutcome?: StaticOutcome;
};

export type AffixRequestInput = {
  actorId: string;
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  staticOutcome?: StaticOutcome;
};

export type ActorActionSpec<K extends ActionKind = ActionKind> = {
  /** 给模型看的工具形状；按本回合可见范围生成，所以是函数。 */
  buildTool: (context: ActorTurnContext) => ToolDefinition;
  parse: (args: Record<string, unknown>) => Extract<ActorAction, { kind: K }>;
  resolve: (
    context: ResolveContext,
    action: Extract<ActorAction, { kind: K }>,
  ) => Promise<Extract<ResolvedAction, { kind: K }>>;
  apply: (
    context: ApplyContext,
    resolved: Extract<ResolvedAction, { kind: K }>,
  ) => Promise<ActionResult>;
  /** 这个动作不在可用清单里时的定向说明；省略则用通用文案。 */
  blockedReason?: (actorName: string) => string;
  /** 要不要把静态结果交给推理端补词缀；不实现就是不补。 */
  affixRequest?: (
    resolved: Extract<ResolvedAction, { kind: K }>,
    input: AffixRequestInput,
  ) => AffixRequest | null;
};

/** 只回反馈文本的落账实现包一层，省得每一行都写一遍结果对象。 */
function feedbackOnly<R>(
  apply: (context: ApplyContext, resolved: R) => Promise<string>,
): (context: ApplyContext, resolved: R) => Promise<ActionResult> {
  return async (context, resolved) => ({ feedback: await apply(context, resolved) });
}

export const ACTOR_ACTIONS = {
  say: {
    buildTool: (context) => buildSayTool(context.targets),
    parse: parseSay,
    resolve: async (context, action) =>
      resolveSay(
        context.stage,
        context.actorRow.actor.id,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applySay>[3]>(async (context, resolved) =>
      applySay(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  whisper: {
    buildTool: (context) => buildWhisperTool(context.targets),
    parse: parseWhisper,
    resolve: async (context, action) =>
      resolveWhisper(
        context.stage,
        context.actorRow.actor.id,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applyWhisper>[3]>(async (context, resolved) =>
      applyWhisper(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  announce: {
    buildTool: () => buildAnnounceTool(),
    parse: parseAnnounce,
    resolve: async (context, action) => {
      assertNoSystemReference(action.message);
      return { kind: "announce", action, stage: context.stage };
    },
    apply: feedbackOnly<Parameters<typeof applyAnnounce>[3]>(async (context, resolved) =>
      applyAnnounce(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  call: {
    buildTool: () => buildCallTool(),
    parse: parseCall,
    resolve: async (context, action) =>
      resolveCall(
        context.executor,
        context.world,
        context.stage,
        context.actorRow.actor.id,
        action,
      ),
    apply: feedbackOnly<Parameters<typeof applyCall>[2]>(async (context, resolved) =>
      applyCall(context.executor, context.gameId, resolved, context.now, context.trace),
    ),
  },
  move: {
    buildTool: (context) => buildMoveTool(context.stageRefs),
    parse: parseMove,
    resolve: async (context, action) =>
      resolveMove(context.executor, context.world, context.stage, action),
    apply: feedbackOnly<Parameters<typeof applyMove>[3]>(async (context, resolved) =>
      applyMove(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  teleport: {
    buildTool: () => buildTeleportTool(),
    parse: parseTeleport,
    resolve: async (context, action) =>
      resolveTeleport(context.executor, context.world, context.stage, action),
    apply: feedbackOnly<Parameters<typeof applyTeleport>[3]>(async (context, resolved) =>
      applyTeleport(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  wait: {
    buildTool: () => buildWaitTool(),
    parse: () => parseWait(),
    resolve: async (context, action) => resolveWait(context.stage, action),
    apply: feedbackOnly<Parameters<typeof applyWait>[3]>(async (context, resolved) =>
      applyWait(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  strike: {
    buildTool: (context) => buildStrikeTool(context.targets),
    parse: parseStrike,
    resolve: async (context, action) =>
      resolveStrike(
        context.executor,
        context.stage,
        context.actorRow,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: async (context, resolved) => {
      const result = await applyStrike(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      );
      return {
        feedback: result.feedback,
        staticSettlement: result.settlement,
        staticOutcome: result.outcome,
      };
    },
    affixRequest: (resolved, input) =>
      itemAffixRequest(
        "strike",
        resolved.item,
        {
          targetActorId: resolved.target.id,
        },
        input,
      ),
  },
  cleave: {
    buildTool: (context) => buildCleaveTool(context.targets, context.actionCaps.cleave ?? 1),
    parse: parseCleave,
    resolve: async (context, action) => {
      // 目标逐个解析：每个目标都在当前舞台，且不受本回合位移影响。
      const targets: ActorRow[] = [];
      for (const handle of action.targetActorHandles) {
        targets.push(await context.visible(handle));
      }
      return resolveCleave(context.executor, context.stage, context.actorRow, action, targets);
    },
    apply: feedbackOnly<Parameters<typeof applyCleave>[3]>(async (context, resolved) =>
      applyCleave(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  brawl: {
    buildTool: (context) => buildBrawlTool(context.targets),
    parse: parseBrawl,
    resolve: async (context, action) =>
      resolveBrawl(
        context.stage,
        context.actorRow,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applyBrawl>[3]>(async (context, resolved) =>
      applyBrawl(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  steal: {
    buildTool: (context) => buildStealTool(context.targets),
    parse: parseSteal,
    resolve: async (context, action) =>
      resolveSteal(
        context.executor,
        context.stage,
        context.actorRow,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applySteal>[3]>(async (context, resolved) =>
      applySteal(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  inspect: {
    buildTool: (context) => buildInspectTool(context.targets),
    parse: parseInspect,
    resolve: async (context, action) =>
      resolveInspect(
        context.executor,
        context.stage,
        context.actorRow,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applyInspect>[3]>(async (context, resolved) =>
      applyInspect(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  loot: {
    buildTool: (context) => buildLootTool(context.targets),
    parse: parseLoot,
    resolve: async (context, action) =>
      resolveLoot(
        context.executor,
        context.stage,
        context.actorRow.actor.id,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applyLoot>[3]>(async (context, resolved) =>
      applyLoot(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  give: {
    buildTool: (context) => buildGiveTool(context.targets),
    parse: parseGive,
    resolve: async (context, action) =>
      resolveGive(
        context.executor,
        context.stage,
        context.actorRow.actor.id,
        action,
        await context.visible(action.targetActorHandle),
      ),
    apply: feedbackOnly<Parameters<typeof applyGive>[3]>(async (context, resolved) =>
      applyGive(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      ),
    ),
  },
  pickup: {
    buildTool: (context) =>
      buildPickupTool(
        context.current.stage.anchors.map((anchor) => anchor.label),
        stageItemNames(context.current.stage),
      ),
    parse: parsePickup,
    resolve: async (context, action) => resolvePickup(context.executor, context.stage, action),
    apply: feedbackOnly<Parameters<typeof applyPickup>[3]>(async (context, resolved) =>
      applyPickup(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  use: {
    buildTool: (context) =>
      buildUseTool(
        context.triggerItems.use,
        context.selfAndTargets,
        context.current.stage.name,
        context.current.stage.anchors.map((anchor) => anchor.label),
      ),
    parse: parseUse,
    resolve: async (context, action) => {
      // 目标可选：不点名角色就是对当前舞台本身使用。
      const target = action.targetActorHandle
        ? await context.visible(action.targetActorHandle)
        : undefined;
      return resolveUse(context.executor, context.stage, context.actorRow, action, target);
    },
    apply: async (context, resolved) => {
      const result = await applyUse(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      );
      return {
        feedback: result.feedback,
        staticSettlement: result.settlement,
        staticOutcome: result.outcome,
      };
    },
    // 授权来自道具而非角色天赋：玩家入口绕过工具列表，不可用时要说明原因。
    blockedReason: (actorName) => `${actorName}没有可用的道具：use 需要一件声明了使用词缀的道具`,
    affixRequest: (resolved, input) =>
      itemAffixRequest(
        "use",
        resolved.transferItem,
        {
          ...(resolved.target ? { targetActorId: resolved.target.id } : {}),
          ...(resolved.targetStage ? { targetStageId: resolved.targetStage.id } : {}),
          ...(resolved.targetAnchor !== undefined ? { targetAnchor: resolved.targetAnchor } : {}),
        },
        input,
      ),
  },
  fit: {
    buildTool: (context) =>
      buildFitTool(
        context.triggerItems.fit,
        context.current.stage.anchors.map((anchor) => anchor.label),
      ),
    parse: parseFit,
    resolve: async (context, action) =>
      resolveFit(context.executor, context.stage, context.actorRow, action),
    apply: async (context, resolved) => {
      const result = await applyFit(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.address,
        context.trace,
      );
      return {
        feedback: result.feedback,
        staticSettlement: result.settlement,
        staticOutcome: result.outcome,
      };
    },
    affixRequest: (resolved, input) =>
      itemAffixRequest("fit", resolved.transferItem, { targetAnchor: resolved.anchorLabel }, input),
  },
  equip: {
    buildTool: (context) => buildEquipTool(context.wearableItemNames),
    parse: parseEquip,
    resolve: async (context, action) => resolveEquip(context.executor, context.actorRow, action),
    apply: feedbackOnly<Parameters<typeof applyEquip>[3]>(async (context, resolved) =>
      applyEquip(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
  unequip: {
    buildTool: (context) => buildUnequipTool(context.occupiedSlots),
    parse: parseUnequip,
    resolve: async (context, action) => resolveUnequip(context.actorRow, action),
    apply: feedbackOnly<Parameters<typeof applyUnequip>[3]>(async (context, resolved) =>
      applyUnequip(
        context.executor,
        context.gameId,
        context.actorRow,
        resolved,
        context.now,
        context.trace,
      ),
    ),
  },
} satisfies { [K in ActionKind]: ActorActionSpec<K> };

/** 词缀请求的目标：角色、舞台或锚点，按动作各自给得出哪个填哪个。 */
type AffixTargetRefs = {
  targetActorId?: string;
  targetStageId?: string;
  targetAnchor?: string;
};

/**
 * 道具触发的动作要不要交给推理端补词缀：有 agent 词缀才交。
 *
 * 三个带道具的触发共用这一份判断，目标由调用方给。
 */
function itemAffixRequest(
  trigger: "strike" | "use" | "fit",
  item: { id: string; affixes: AffixTriggers },
  target: AffixTargetRefs,
  input: AffixRequestInput,
): AffixRequest | null {
  if (agentAffixes(item, trigger).length === 0) {
    return null;
  }
  return {
    actorId: input.actorId,
    itemId: item.id,
    trigger,
    ...target,
    defaultFeedback: input.defaultFeedback,
    ...(input.staticSettlement ? { staticSettlement: input.staticSettlement } : {}),
    ...(input.staticOutcome ? { staticOutcome: input.staticOutcome } : {}),
  };
}

/** 调度入口：按 kind 取一行；类型之外的 kind 直接拒绝，不静默跳过。 */
export function actionSpec(kind: ActionKind): ActorActionSpec {
  const spec = (ACTOR_ACTIONS as Record<string, ActorActionSpec | undefined>)[kind];
  if (!spec) {
    throw new GameError("invalid_action", `未知动作: ${kind}`);
  }
  return spec;
}

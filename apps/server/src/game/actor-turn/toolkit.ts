import type { ToolDefinition } from "../../llm/types";
import { buildAnnounceTool, parseAnnounce } from "../actions/announce";
import { buildBrawlTool, parseBrawl } from "../actions/brawl";
import { buildCallTool, parseCall } from "../actions/call";
import { buildCleaveTool, parseCleave } from "../actions/cleave";
import { buildEquipTool, parseEquip } from "../actions/equip";
import { buildGiveTool, parseGive } from "../actions/give";
import { buildInspectTool, parseInspect } from "../actions/inspect";
import { buildLootTool, parseLoot } from "../actions/loot";
import { buildMoveTool, parseMove } from "../actions/move";
import { buildPickupTool, parsePickup } from "../actions/pickup";
import { buildSayTool, parseSay } from "../actions/say";
import { buildStealTool, parseSteal } from "../actions/steal";
import { buildStrikeTool, parseStrike } from "../actions/strike";
import { buildTeleportTool, parseTeleport } from "../actions/teleport";
import { buildUnequipTool, parseUnequip } from "../actions/unequip";
import { buildUseTool, parseUse } from "../actions/use";
import { buildWaitTool, parseWait } from "../actions/wait";
import { buildWhisperTool, parseWhisper } from "../actions/whisper";
import { stageItemNames } from "../plan";
import type { ActionKind, ActorAction } from "../types";
import type { ActorTurnContext } from "./context";

/**
 * 一个动作在 actor 回合里的两个接口：给模型看的工具形状，与把参数变回动作的解析器。
 *
 * 两者放在同一条记录里，新增动作只加一项；`Record<ActionKind, …>` 让漏写变成编译错误，
 * 不会出现「有工具没解析器」的半条通道。工具形状按本回合的可见范围生成，所以是函数。
 */
export type ActorActionToolkit = {
  build: (context: ActorTurnContext) => ToolDefinition;
  parse: (args: Record<string, unknown>) => ActorAction;
};

export const ACTOR_ACTION_TOOLKITS: Record<ActionKind, ActorActionToolkit> = {
  say: { build: (context) => buildSayTool(context.targets), parse: parseSay },
  whisper: { build: (context) => buildWhisperTool(context.targets), parse: parseWhisper },
  announce: { build: () => buildAnnounceTool(), parse: parseAnnounce },
  call: { build: () => buildCallTool(), parse: parseCall },
  move: { build: (context) => buildMoveTool(context.stageRefs), parse: parseMove },
  teleport: { build: () => buildTeleportTool(), parse: parseTeleport },
  wait: { build: () => buildWaitTool(), parse: () => parseWait() },
  strike: { build: (context) => buildStrikeTool(context.targets), parse: parseStrike },
  cleave: {
    build: (context) => buildCleaveTool(context.targets, context.cleaveMaxTargets),
    parse: parseCleave,
  },
  brawl: { build: (context) => buildBrawlTool(context.targets), parse: parseBrawl },
  steal: { build: (context) => buildStealTool(context.targets), parse: parseSteal },
  inspect: { build: (context) => buildInspectTool(context.targets), parse: parseInspect },
  loot: { build: (context) => buildLootTool(context.targets), parse: parseLoot },
  give: { build: (context) => buildGiveTool(context.targets), parse: parseGive },
  pickup: {
    build: (context) =>
      buildPickupTool(
        context.current.stage.anchors.map((anchor) => anchor.label),
        stageItemNames(context.current.stage),
      ),
    parse: parsePickup,
  },
  use: {
    build: (context) =>
      buildUseTool(
        context.usableItemNames,
        context.selfAndTargets,
        context.current.stage.name,
        context.current.stage.anchors.map((anchor) => anchor.label),
      ),
    parse: parseUse,
  },
  equip: { build: (context) => buildEquipTool(context.wearableItemNames), parse: parseEquip },
  unequip: { build: (context) => buildUnequipTool(context.occupiedSlots), parse: parseUnequip },
};

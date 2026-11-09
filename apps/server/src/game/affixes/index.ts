export type { StaticItemActionInput, StaticItemActionResult } from "./action";
export { applyStaticItemAction } from "./action";
export type { AffixTrigger } from "./model";
export {
  affixesFor,
  affixMode,
  agentAffixes,
  hasAffixes,
  normalizeAffixTriggers,
  staticAffixes,
} from "./model";
export { buildAffixPrompt, buildAffixSystemPrompt } from "./prompt";
export { runAffixPhase } from "./run";
export type { StaticSettlement } from "./static";
export type { AffixOperation, AffixRequest, StaticOutcome } from "./types";

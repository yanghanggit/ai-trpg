export {
  type ApplyItemActionInput,
  type ApplyItemActionResult,
  applyItemAction,
  applyUnarmedAction,
} from "./action";
export { type ApplySettlementInput, type ApplySettlementResult, applySettlement } from "./apply";
export { resolveRules } from "./rules";
export { settle, settleAdditionalDamage } from "./settle";
export { type BuildActorSnapshotInput, buildActorSnapshot, type SnapshotMode } from "./snapshot";
export type {
  ActorSnapshot,
  HpEffect,
  ItemSnapshot,
  ResolvedRules,
  SettlementHitResult,
  SettlementInput,
  SettlementOutcome,
  SettlementRole,
  SettlementWitness,
} from "./types";
export {
  type AppendWitnessInput,
  appendWitnessEvent,
  assertWitnessTargetMatches,
  renderWitness,
  type WitnessEvent,
  type WitnessTarget,
} from "./witness";

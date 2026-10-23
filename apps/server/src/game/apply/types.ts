import type { Database } from "../../db/pool";
import type { actors, items, stageItems, stages, worlds } from "../../db/schema";
import type {
  AnnounceAction,
  AttackAction,
  GiveAction,
  MessageVisibility,
  MoveAction,
  PickupAction,
  SayAction,
  StealAction,
  UseAction,
  WaitAction,
  WhisperAction,
} from "../types";

export type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;
export type WorldRow = typeof worlds.$inferSelect;
export type StageRow = typeof stages.$inferSelect;
export type ActorRow = typeof actors.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type StageItemRow = typeof stageItems.$inferSelect;
export type ActorWithStageRow = { actor: ActorRow; stage: StageRow };

export type PublicMessage = {
  kind: string;
  stageId: string | null;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
};

/** 通过校验、已解析出具体对象的动作；`kind` 与动作类型一一对应。 */
export type ResolvedSay = {
  kind: "say";
  action: SayAction;
  stage: StageRow;
  target: ActorRow;
};

export type ResolvedWhisper = {
  kind: "whisper";
  action: WhisperAction;
  stage: StageRow;
  target: ActorRow;
};

export type ResolvedAnnounce = {
  kind: "announce";
  action: AnnounceAction;
  stage: StageRow;
};

export type ResolvedMove = {
  kind: "move";
  action: MoveAction;
  stage: StageRow;
  targetStage: StageRow;
};

export type ResolvedWait = {
  kind: "wait";
  action: WaitAction;
  stage: StageRow;
};

export type ResolvedAttack = {
  kind: "attack";
  action: AttackAction;
  stage: StageRow;
  target: ActorRow;
  item?: ItemRow;
};

export type ResolvedSteal = {
  kind: "steal";
  action: StealAction;
  stage: StageRow;
  target: ActorRow;
  transferItem: ItemRow;
};

export type ResolvedGive = {
  kind: "give";
  action: GiveAction;
  stage: StageRow;
  target: ActorRow;
  transferItem: ItemRow;
};

export type ResolvedPickup = {
  kind: "pickup";
  action: PickupAction;
  stage: StageRow;
  stageItem: StageItemRow;
};

export type ResolvedUse = {
  kind: "use";
  action: UseAction;
  stage: StageRow;
  transferItem: ItemRow;
  target?: ActorRow;
  targetStage?: StageRow;
};

export type ResolvedAction =
  | ResolvedSay
  | ResolvedWhisper
  | ResolvedAnnounce
  | ResolvedMove
  | ResolvedWait
  | ResolvedAttack
  | ResolvedSteal
  | ResolvedGive
  | ResolvedPickup
  | ResolvedUse;

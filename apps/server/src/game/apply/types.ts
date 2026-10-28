import type { Database } from "../../db/pool";
import type { actors, items, stageItems, stages, worlds } from "../../db/schema";
import type {
  AnnounceAction,
  AttackAction,
  EquipAction,
  GiveAction,
  MessageVisibility,
  MoveAction,
  PickupAction,
  SayAction,
  StealAction,
  UnequipAction,
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

/** 已解析的名字信念：句柄换成形象 id，写入时不再依赖可变的展示名。 */
export type ResolvedIdentity = {
  handle: string;
  name: string;
  actorId: string;
  presentationId: string;
  stageId: string;
};

export type ResolvedPlan = {
  actions: ResolvedAction[];
  identities: ResolvedIdentity[];
};

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

export type ResolvedEquip = {
  kind: "equip";
  action: EquipAction;
  stage: StageRow;
  item: ItemRow;
};

export type ResolvedUnequip = {
  kind: "unequip";
  action: UnequipAction;
  stage: StageRow;
  itemName: string;
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
  | ResolvedUse
  | ResolvedEquip
  | ResolvedUnequip;

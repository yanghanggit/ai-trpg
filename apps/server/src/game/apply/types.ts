import type { Database } from "../../db/pool";
import type { actors, items, stageItems, stages, worlds } from "../../db/schema";
import type {
  AnnounceAction,
  BrawlAction,
  CallAction,
  CleaveAction,
  EquipAction,
  GiveAction,
  LootAction,
  MessageVisibility,
  MoveAction,
  PickupAction,
  RouteFailure,
  RouteQuery,
  SayAction,
  StealAction,
  StrikeAction,
  TeleportAction,
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

/** 已解析的名字绑定：句柄换成签名 id，写入时不再依赖可变的展示名。 */
export type ResolvedIdentity = {
  handle: string;
  name: string;
  actorId: string;
  signatureId: string;
};

export type ResolvedPlan = {
  actions: ResolvedAction[];
  identities: ResolvedIdentity[];
  routes: RouteQuery[];
  routeFailures: RouteFailure[];
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

/** 跨场景传音：source stage 与 target stage 分开保存，目标必须不在 source stage。 */
export type ResolvedCall = {
  kind: "call";
  action: CallAction;
  stage: StageRow;
  target: ActorRow;
  targetStage: StageRow;
};

export type ResolvedMove = {
  kind: "move";
  action: MoveAction;
  stage: StageRow;
  targetStage: StageRow;
};

export type ResolvedTeleport = {
  kind: "teleport";
  action: TeleportAction;
  stage: StageRow;
  targetStage: StageRow;
};

export type ResolvedWait = {
  kind: "wait";
  action: WaitAction;
  stage: StageRow;
};

export type ResolvedStrike = {
  kind: "strike";
  action: StrikeAction;
  stage: StageRow;
  target: ActorRow;
  item: ItemRow;
};

export type ResolvedCleave = {
  kind: "cleave";
  action: CleaveAction;
  stage: StageRow;
  /** 已按武器 `maxTargets` 校验过的目标；顺序即结算顺序。 */
  targets: ActorRow[];
  item: ItemRow;
};

export type ResolvedBrawl = {
  kind: "brawl";
  action: BrawlAction;
  stage: StageRow;
  target: ActorRow;
};

export type ResolvedSteal = {
  kind: "steal";
  action: StealAction;
  stage: StageRow;
  target: ActorRow;
  transferItem: ItemRow;
};

export type ResolvedLoot = {
  kind: "loot";
  action: LootAction;
  stage: StageRow;
  target: ActorRow;
  /** 本次搜走的物品，按请求顺序；省略名单时是尸体身上的全部。 */
  items: ItemRow[];
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
  /** 物品所在的锚点标签；反馈与观察要写出「从哪儿取下」。 */
  anchorLabel: string;
};

export type ResolvedUse = {
  kind: "use";
  action: UseAction;
  stage: StageRow;
  transferItem: ItemRow;
  target?: ActorRow;
  targetStage?: StageRow;
  /** 已按当前场景锚点校验过的标签。 */
  targetAnchor?: string;
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
  | ResolvedCall
  | ResolvedMove
  | ResolvedTeleport
  | ResolvedWait
  | ResolvedStrike
  | ResolvedCleave
  | ResolvedBrawl
  | ResolvedSteal
  | ResolvedLoot
  | ResolvedGive
  | ResolvedPickup
  | ResolvedUse
  | ResolvedEquip
  | ResolvedUnequip;

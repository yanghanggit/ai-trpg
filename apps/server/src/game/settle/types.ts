import type { TraceContext } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
import type { AffixRequest } from "../agents/affixes";
import type {
  AnnounceAction,
  BrawlAction,
  CallAction,
  CleaveAction,
  DeathSettlement,
  EquipAction,
  GiveAction,
  InspectAction,
  LootAction,
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
} from "../kernel/types";
import type { ActorRow, ItemRow, StageItemRow, StageRow } from "../persistence/rows";

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

/** 跨舞台传音：source stage 与 target stage 分开保存，目标必须不在 source stage。 */
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
  /** 敏捷持平：偷得到，但目标会察觉。高于目标时是 false，低于目标时根本解析不通过。 */
  noticed: boolean;
};

export type ResolvedInspect = {
  kind: "inspect";
  action: InspectAction;
  stage: StageRow;
  target: ActorRow;
  /** 敏捷不高于目标：对方会知道自己在被查看。高于目标时不产生任何观察。 */
  noticed: boolean;
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
  /** 已按当前舞台锚点校验过的标签。 */
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
  | ResolvedInspect
  | ResolvedLoot
  | ResolvedGive
  | ResolvedPickup
  | ResolvedUse
  | ResolvedEquip
  | ResolvedUnequip;

/** 结算的推理端依赖：词缀、外观、死亡收尾各自按需取用。 */
export type IncrementOptions = {
  /** 词缀补充效果需要 LLM agent。 */
  service?: ChatCompletionService;
  /** 提交后的推理阶段（换装外观、尸体外观、掉落）需要 LLM；不传则只跑确定性的部分。 */
  inferenceService?: ChatCompletionService;
  /** 子阶段的失败只进日志与返回值，不抛给调用方。 */
  logger?: Logger;
  /** 回合轨迹；有值时记录计划、拒绝、落账与子阶段结果。 */
  trace?: TraceContext;
};

export type SettleActorPlanOptions = IncrementOptions & {
  /** 回合结束后审计新增的 actor 记忆；默认读 TRPG_AUDIT_NAMES。 */
  auditNameLeaks?: boolean;
};

/** 应用计划的结果；`rejection` 是给调用方（尤其是玩家入口）看的原因。 */
export type SettlePlanResult = {
  ok: boolean;
  rejection?: string;
  /** 拒绝类别，与写入 memory 的 kind 一致；轨迹按它聚合。 */
  rejectionCode?: string;
  affixRequests?: AffixRequest[];
  /** 实际落账的动作事件（事务提交后才写轨迹）。 */
  applied?: { event: "applied"; actionKind: string; feedback: string }[];
  /** 这次行动之后逐个收尾的死者；失败不回滚这次行动。 */
  death?: DeathSettlement[];
  /** 取死者名单这一步没能跑起来的原因（例如数据库错误）；行动本身仍然成功。 */
  deathError?: string;
};

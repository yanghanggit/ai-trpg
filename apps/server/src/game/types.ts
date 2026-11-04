import type { ChatMessage, ToolDefinition } from "../llm/types";
import type { Stats } from "./attributes";

/** 公共消息的可见范围：场景公开或仅当事人可见。 */
export type MessageVisibility = "stage" | "private";

/** 物品大类；每个大类对应一个运行时子类。 */
export type ItemKind =
  | "weapon"
  | "equipment"
  | "accessory"
  | "consumable"
  | "valuable"
  | "material";

/**
 * 物品的声明式效果：只存可序列化 JSON，`type` 路由到 handler，物品不持有函数。
 */
export type ItemEffect = {
  type: string;
  [key: string]: unknown;
};

/**
 * actor 的穿戴槽：槽里只记录物品名，物品自身不知道被谁穿戴。
 * 开发期只保留一武器、一护甲（合并副手/头/身体/足部）、一饰品。
 */
export const EQUIPMENT_SLOTS = ["weapon", "armor", "accessory"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
export type EquipmentSlots = Partial<Record<EquipmentSlot, string>>;

/** 快照里的穿戴项；物品之后可能改名或删除，所以必须存当时的副本。 */
export type AppearanceWornItem = {
  slot: EquipmentSlot;
  itemId: string;
  name: string;
  kind: ItemKind;
  description: string;
};

/**
 * 生成外观那一刻的输入快照。
 *
 * 运行时分支保存发给模型的完整 prompt 与结构化上下文；seed 分支只记录内容来源。
 */
export type AppearanceInput =
  | {
      version: 1;
      source: "seed";
      contentKey: string;
      contentVersion: string;
      actorKey: string;
      form: string;
      /** 种子没写 appearance 时为 true，text 回退为 form。 */
      fallback: boolean;
    }
  | {
      version: 1;
      promptVersion: number;
      source: "runtime";
      /** provider 未暴露模型名时为 null。 */
      model: string | null;
      prompt: {
        messages: readonly ChatMessage[];
        inputMessage: string;
        tools: readonly ToolDefinition[];
        maxRounds: number;
      };
      context: {
        form: string;
        dead: boolean;
        contentVersion: string;
        worn: readonly AppearanceWornItem[];
        /** 本次变化的可见简报；由角色自己或调用方提供。 */
        brief?: string;
      };
    };

/** 当前可见外观：id 用于追溯来源，text 是最终渲染值。 */
export type AppearanceState = {
  id: string;
  text: string;
};

export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: "武器",
  armor: "护甲",
  accessory: "饰品",
};

export const EQUIPMENT_SLOT_KINDS: Record<EquipmentSlot, readonly ItemKind[]> = {
  weapon: ["weapon"],
  armor: ["equipment"],
  accessory: ["accessory"],
};

/** 世界职能：世界级单例，有宪法与自己的一份口径，没有 memory。 */
export const WORLD_FUNCTION_TYPES = [
  "drops",
  "affixes",
  "story",
  "compact",
  "dialogueAudit",
] as const;

export type WorldFunctionType = (typeof WORLD_FUNCTION_TYPES)[number];

/** 每份世界职能在本世界的口径；由内容提供，随 World 快照落库。 */
export type WorldFunctionProfiles = Record<WorldFunctionType, string>;

/**
 * 场景内的可交互锚点：actor 能明确指认的位置或部位。
 *
 * 它只是可供性索引，不承载效果；`use` 只能从当前场景的锚点里选。
 */
export type StageAnchor = {
  /** 世界面短标签，场景内唯一。 */
  label: string;
  /** 可选的可观察细节；不写后果或机制。 */
  description?: string;
};

/** 场景边的通行状态；sealed 表示两侧在剧情上相连，但当前不能通过。 */
export type PassageState = "open" | "sealed";

/** 词缀：短名字 + 一句自然语言规则；展示与提示词统一为 `[名字]内容`。 */
export type Affix = {
  name: string;
  content: string;
};

export type SayAction = {
  kind: "say";
  mind: string;
  targetActorHandle: string;
  message: string;
};

/** 对同场景的一个角色耳语，只有对方能听见。 */
export type WhisperAction = {
  kind: "whisper";
  mind: string;
  targetActorHandle: string;
  message: string;
};

export type AnnounceAction = {
  kind: "announce";
  mind: string;
  message: string;
};

/** 用目标真名跨场景传话；双方都要有 call 能力，目标必须不在当前场景，只有目标听见。 */
export type CallAction = {
  kind: "call";
  mind: string;
  /** 目标的真名；不接收 @名字、#编号 或 id。 */
  targetActorName: string;
  message: string;
};

export type MoveAction = {
  kind: "move";
  targetStageName: string;
};

/** 传送到一个知道真名、且未被 teleport_blocked 的场景；一次一跳，不沿路径移动。 */
export type TeleportAction = {
  kind: "teleport";
  targetStageName: string;
};

export type WaitAction = {
  kind: "wait";
};

/** 用武器攻击同场景角色；武器隐式取自 `equipment.weapon`，且必须提供 `strike`。 */
export type StrikeAction = {
  kind: "strike";
  targetActorHandle: string;
};

/** 用身体攻击同场景角色；不读物品，伤害只来自自身 stats。 */
export type BrawlAction = {
  kind: "brawl";
  targetActorHandle: string;
};

export type StealAction = {
  kind: "steal";
  targetActorHandle: string;
  itemName: string;
};

/** 把自己持有的一件物品交给同场景的一个角色；尸体也可以是接收方。 */
export type GiveAction = {
  kind: "give";
  targetActorHandle: string;
  itemName: string;
};

export type PickupAction = {
  kind: "pickup";
  itemName: string;
};

/**
 * 使用自己持有的一件物品，作用于一个角色或当前场景。
 *
 * 所有引用物品的动作都遵循同一原则：动作是触发者，物品只是输入；
 * 每个动作最多引用一件物品，由动作声明是否必需与允许的类别。
 */
export type UseAction = {
  kind: "use";
  itemName: string;
  targetActorHandle?: string;
  targetStageName?: string;
  /** 当前场景的可交互锚点标签；必须来自该场景的 `anchors`。 */
  targetAnchor?: string;
};

export type EquipAction = {
  kind: "equip";
  itemName: string;
  slot: EquipmentSlot;
};

export type UnequipAction = {
  kind: "unequip";
  slot: EquipmentSlot;
};

/** 一次 actor 行动；十五个具体动作平级，不再有中间分类层。 */
export type ActorAction =
  | SayAction
  | WhisperAction
  | AnnounceAction
  | CallAction
  | MoveAction
  | TeleportAction
  | WaitAction
  | StrikeAction
  | BrawlAction
  | StealAction
  | GiveAction
  | PickupAction
  | UseAction
  | EquipAction
  | UnequipAction;

export type ActionKind = ActorAction["kind"];

/**
 * 四个沟通动作；观察与提示词按这组区分「对谁说话、谁能听见」。
 * 从 `ActorAction` 派生，新增沟通动作时不会和动作清单脱钩。
 */
export type CommunicationKind = Extract<ActionKind, "say" | "whisper" | "announce" | "call">;

/** 会改变物品归属或使用状态的四个动作；物品观察按这组分叉文本。 */
export type ItemEventKind = Extract<ActionKind, "steal" | "give" | "pickup" | "use">;

/** stage 的一次仲裁动作；与 actor / world 的计划同构，都是有序动作列表。 */
export type StageAction =
  | {
      kind: "submit_environment";
      environment?: string;
      /** 完整锚点快照；省略表示不修改，空数组表示全部移除。 */
      anchors?: StageAnchor[];
    }
  | { kind: "notify_world"; notification: string }
  | { kind: "open_passage"; targetStageName: string };

/** 场景作为小 GM 能执行的动作；能力清单成员，由 `StageAction` 派生。 */
export type StageActionKind = StageAction["kind"];

/** 把某个引用记成自己当前的称呼；只改自己的记忆。 */
export type IdentityBinding = {
  handle: string;
  /** 观察者当前想怎么称呼这个签名；不必是真名。 */
  name: string;
};

/** 一轮计划：按提交顺序执行的动作列表；条数上限由 `MAX_ACTIONS_PER_TURN` 约束。 */
export type ActorPlan = {
  actions: ActorAction[];
  /** 认知更新：与动作同事务落账，但不产生公共事件、不占行动名额。 */
  identities?: IdentityBinding[];
};

/** stage 小 GM 的一轮仲裁计划：按提交顺序更新 environment 或向 world 发通知。 */
export type StagePlan = {
  actions: StageAction[];
};

/** world 对 stage 的下行动作。 */
export type WorldAction =
  | { kind: "notify_stage"; stageName: string; content: string }
  | { kind: "end_game"; message: string; outcome: string };

/** world 的能力清单成员；由 `WorldAction` 派生。 */
export type WorldActionKind = WorldAction["kind"];

/** world 的一轮计划。 */
export type WorldPlan = {
  actions: WorldAction[];
};

/** 所有物品状态的公共根字段：身份、分类、数量与属性。 */
export type ItemBaseState = {
  id: string;
  /** 本局内唯一的排序号；身份仍用 id。 */
  seq: number;
  /** 世界内稳定 key；旧数据缺失时由 toItemState 回退到 name。 */
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
  /** 物品效果；由内容显式声明，运行时按 type 路由。 */
  effect: ItemEffect;
  /** 词缀；非空时 damage 路由到 LLM 结算 handler。 */
  affixes: readonly Affix[];
  /** 物品能提供的动作；穿戴中才借给角色。 */
  actions: readonly ActionKind[];
  /** 归一化后的完整属性；五种物品都携带，未用到的字段为 0。 */
  stats: Stats;
};

/** 武器：`strike` 读它的 `damage`；穿戴后 `block` 与其它槽一样计入减伤。 */
export type WeaponState = ItemBaseState & { kind: "weapon" };

/** 装备：不能用于出手，但穿戴后 `block` 计入减伤。 */
export type EquipmentState = ItemBaseState & { kind: "equipment" };

/** 饰品：随身携带的非战斗物品。 */
export type AccessoryState = ItemBaseState & { kind: "accessory" };

/** 可穿戴物品状态的联合，用于外观推理筛选。 */
export type WearableItemState = WeaponState | EquipmentState | AccessoryState;

/** 消耗品：数量语义保留；当前 `use` 不自动扣除 count。 */
export type ConsumableState = ItemBaseState & { kind: "consumable" };

/** 贵重物品：无战斗数值的剧情物品。 */
export type ValuableState = ItemBaseState & { kind: "valuable" };

/** 材料：尸体留下的物理素材；不可穿戴、没有效果，只能搬运与堆叠。 */
export type MaterialState = ItemBaseState & {
  kind: "material";
  /** 源于哪个角色；只有死亡掉落会填，内容声明的材料可以为 null。 */
  source: string | null;
};

export type ItemState =
  | WeaponState
  | EquipmentState
  | AccessoryState
  | ConsumableState
  | ValuableState
  | MaterialState;

/**
 * actor 当前可被看见的签名。
 *
 * 状态快照里只保留寻址需要的字段；形态由 `ActorState.signature` 携带，
 * 当前外观记录由 `ActorState.appearance` 携带。
 */
export type SignatureState = {
  id: string;
  /** 本局内唯一的排序号；观察者句柄由它派生（`#<seq>`）。 */
  seq: number;
  /** 稳定形态，`种族:描述`；换装不改写它。 */
  form: string;
};

export type ActorState = {
  id: string;
  /** 本局内唯一的排序号；身份仍用 id。 */
  seq: number;
  /** 内容层稳定 key。 */
  key: string;
  name: string;
  profile: string;
  /** 当前外观；`text` 是最终渲染值，`id` 用于追溯生成来源。 */
  appearance: AppearanceState;
  /** 当前正在使用的签名；观察者编号与名字绑定都以它为单位。 */
  signature: SignatureState;
  stats: Stats;
  /** 当前生命；扣血只写这个字段，不再重写整块属性。`hp === 0` 即死亡。 */
  hp: number;
  /** 是否为默认玩家角色；主角死亡时只通知 world，收尾由 world 回合决定。 */
  isDefaultPlayer: boolean;
  equipment: EquipmentSlots;
  items: ItemState[];
  actions: readonly ActionKind[];
};

export type StageState = {
  id: string;
  /** 本局内唯一的实体序号；未访问场景的 #seq 句柄由它派生。 */
  seq: number;
  /** 世界内稳定 key；旧数据缺失时回退到 name。 */
  key: string;
  name: string;
  profile: string;
  environment: string;
  anchors: StageAnchor[];
  ordinal: number;
  teleportBlocked: boolean;
  actors: ActorState[];
  items: ItemState[];
  actions: readonly StageActionKind[];
};

export type ConnectionState = {
  id: string;
  fromStageId: string;
  toStageId: string;
  passage: PassageState;
};

export type MessageState = {
  id: string;
  sequence: number;
  kind: string;
  stageId: string | null;
  sourceActorId: string | null;
  targetActorId: string | null;
  visibility: MessageVisibility;
  content: string;
  createdAt: string;
};

export type PlayerState = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
};

/** 运行时 world 状态；由 worlds/stages/stage_connections 表水合得到。 */
export type WorldState = {
  id: string;
  /** 本局内唯一的排序号；身份仍用 id。 */
  seq: number;
  name: string;
  profile: string;
  contentKey: string;
  campaignSetting: string;
  globalRules: string;
  worldFunctions: WorldFunctionProfiles;
  actions: WorldActionKind[];
  stages: StageState[];
  connections: ConnectionState[];
};

/**
 * actor 去过哪些场景：名字知识的账本，不是通行证。
 *
 * 建局时起点算一次到访，之后每次 move / teleport 到达都记一条（同一场景只刷新
 * `lastVisitedAt`）。它只影响地图、方向名显示、已知场景查看与传送候选提示；
 * move 的权限在邻接边、teleport 的权限在「知道真名」上，两者都不来自这里。
 */
export type StageVisitState = {
  actorId: string;
  stageId: string;
  firstVisitedAt: string;
  lastVisitedAt: string;
};

/**
 * actor 知道真名、但不是走到那里才知道的场景。
 *
 * 与 `StageVisitState` 互补：到访天然含名字知识，两份合起来才是「已知场景」
 * （`knownStageIds`）。它只影响地图、方向名与提示词，不参与 move 权限，也不扩传送候选。
 */
export type KnownStageState = {
  actorId: string;
  stageId: string;
  firstLearnedAt: string;
  /** 得知渠道：`content`（开局内容）或 `runtime`（台词、观察，以及将来的鸟瞰 / 望远镜）。 */
  source: string;
  /** 在哪个场景听说的；内容直接声明时为 null。 */
  learnedStageId: string | null;
};

export type GameState = {
  game: {
    id: string;
    ownerId: string;
    name: string;
    slug: string;
    status: string;
    /** 结束时的结局标签，由 world 自己命名；active 局为 null。 */
    outcome: string | null;
    contentVersion: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  player: PlayerState;
  world: WorldState;
  messages: MessageState[];
  /** 本局全部签名称呼（god view）；渲染层按观察者过滤后才进提示词。 */
  signatureNames: SignatureNameState[];
  /**
   * 访问历史，按 `firstVisitedAt` 升序；同一时刻并列时按场景序号兜底（可复现）。
   * 用于地图、已访问候选与查看，不参与普通移动权限。
   */
  visits: StageVisitState[];
  /**
   * 非到访得知的场景名，按 `firstLearnedAt` 升序（并列规则同 `visits`）。
   * 到访过的场景可能也在这里——先听说、后走到；地图按 `visits ∪ knownStages` 取已知。
   */
  knownStages: KnownStageState[];
};

/**
 * 不带宽公共事件流的活状态。
 *
 * 判定与渲染只需要 world / stages / actors / items / visits / 签名称呼；
 * 公共事件流（`messages`）只服务控制面（回合交付、快照、故事整理）。
 * 内部读路径用这个切片，不要为了拿一个 id 去装配事件流。
 */
export type GameStateSlice = Omit<GameState, "messages">;

/** 一条签名称呼：观察者当前把某个签名叫作什么；名字不要求是真名。 */
export type SignatureNameState = {
  observerActorId: string;
  signatureId: string;
  name: string;
  source: string;
  learnedStageId: string | null;
};

/** 死亡阶段里一个没做成的收尾动作；失败不改变 hp，也不撤销已宣布的死亡。 */
export type DeathPhaseFailure = {
  actorName: string;
  reason: string;
};

/**
 * 一次死亡阶段的结果。
 *
 * 阶段本身不抛业务错误：单个死者失败只记录在这里，标记没写成，下次调用会重试。
 */
export type DeathPhaseResult = {
  /** 本次认领并宣布死亡的 actor。 */
  settled: string[];
  /** 认领或宣布失败、需要重试的 actor 与原因。 */
  failed: DeathPhaseFailure[];
  /** 死亡已宣布、但尸体外观快照没推成的 actor；按设计可以放着不管。 */
  appearanceFailed: string[];
  /** 本次掉落进场景的材料；`items` 是落到地上的物品名。 */
  dropped: { actorName: string; items: string[] }[];
  /** 宣布成功但掉落没跑成、或返回物不合法的 actor；按设计可以放着不管。 */
  dropFailed: string[];
};

/**
 * 回合结果的交付形状：活状态切片 + 公共事件流游标。
 *
 * 事件流不再随结果整份下发——它随对局线性增长。调用方用 `messageCursor` 作为
 * `afterSequence` 增量拉取本回合产生的事件（`listGameMessages`），需要整份再显式取。
 */
export type TurnDelivery = {
  state: GameStateSlice;
  /** 回合结束时公共事件流里最大的 `sequence`；没有事件时为 0。 */
  messageCursor: number;
};

export type ActorTurnResult = TurnDelivery & {
  ok: boolean;
  plan: ActorPlan | null;
  loopSuccess: boolean;
  /** 本次行动之后死亡阶段的结果；失败不回滚这次行动，但要让上层看得见。 */
  death?: DeathPhaseResult;
};

export type StageTurnResult = TurnDelivery & {
  ok: boolean;
  plan: StagePlan | null;
  loopSuccess: boolean;
};

export type WorldTurnResult = TurnDelivery & {
  ok: boolean;
  plan: WorldPlan | null;
  loopSuccess: boolean;
};

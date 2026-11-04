import type { ChatMessage, ToolDefinition } from "../llm/types";
import type { Stats } from "./attributes";
import type { MemoryKind } from "./constants";

/** 公共消息的可见范围：场景公开或仅当事人可见。 */
export type MessageVisibility = "stage" | "private";

/** 初始裸体形态：种族 + 外观描述；不含衣物与装备。 */
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

/**
 * 创建游戏时的初始内容定义；`createGame` 在一个事务里把它物化为数据库行，
 * 之后以数据库为唯一真相。
 */
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

export type World = {
  contentVersion: string;
  /** 稳定内容标识（剧本 slug）：知识库 collection 用它寻址，改展示名不会断链。 */
  contentKey: string;
  worldName: string;
  /** 世界的自我设定：本剧本里它是什么、负责什么、什么算收束。 */
  profile: string;
  campaignSetting: string;
  globalRules: string;
  /** 世界职能各自的世界口径；内容侧必填，运行时只读。 */
  worldFunctions: WorldFunctionProfiles;
  stages: readonly Stage[];
  connections: readonly Connection[];
  actors: readonly Actor[];
  /** 开局时已经建立的名字绑定：观察者与对象都用 `Actor.key` 引用。 */
  signatureNames?: readonly WorldSignatureName[];
  /** 世界实体可用的动作；必须显式列出。 */
  actions: readonly WorldActionKind[];
};

/**
 * 开局时就已建立的名字绑定。
 *
 * 等价于建局时替观察者执行一次 `recognize_identity`：`observer` 与 `subject` 用内容 key，
 * `name` 是观察者当前对这个签名的称呼；允许是真名、称号、误认或听来的叫法。
 */
export type WorldSignatureName = {
  observer: string;
  subject: string;
  name: string;
};

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

/** World 内的初始场景定义；`key` 仅在创建时用于连接与 actor 归属。 */
export type Stage = {
  key: string;
  name: string;
  profile: string;
  environment: string;
  /** 场景内可交互的锚点，创建后由 stage 回合维护。 */
  anchors?: readonly StageAnchor[];
  /** 暂放在场景中的物品；创建时物化为 `stage_items`。 */
  items?: readonly ItemDefinition[];
  /** 场景自身的能力清单；必须显式列出。 */
  actions: readonly StageActionKind[];
  /** 是否禁止 teleport 进出；普通 move 不受影响。 */
  teleportBlocked?: boolean;
};

/** 场景边的通行状态；sealed 表示两侧在剧情上相连，但当前不能通过。 */
export type PassageState = "open" | "sealed";

/** 场景图的初始有向连接；两端引用 `Stage.key`，默认已通行。 */
export type Connection = {
  from: string;
  to: string;
  passage?: PassageState;
};

/**
 * World 内的初始 actor 定义。
 *
 * `signature` 是它开局时的形态与外观；`form` 必须写成 `种族:描述`，
 * 之后与装备、伤势一起渲染成 appearance。
 */
export type Actor = {
  /**
   * 内容层稳定标识：连接、开场知识等引用角色时用它，不用展示名。
   * 与 `Stage.key` / `ItemDefinition.key` 同义。
   */
  key: string;
  stageKey: string;
  name: string;
  profile: string;
  /**
   * 本局开局注入给该角色的私有简报；只写入 actor memory，不进入 actors 表。
   * 可以承载目标、任务、处境、约束与初始知识，不要求是目标列表。
   */
  openingBriefing?: string;
  /** 开局签名：稳定形态 + 预制外观快照；外观省略时回退到 `form`。 */
  signature: {
    form: string;
    appearance?: string;
  };
  /** 初始穿戴：槽位 → 物品名；物品本身不记录穿戴状态。 */
  equipment?: EquipmentSlots;
  /**
   * 完整属性；`maxHp` / `strength` / `wisdom` / `agility` / `damage` / `block` 全部显式写出。
   * 结算只读 `maxHp` / `damage` / `block`；力量 / 智慧 / 敏捷是保留属性，暂无读取点。
   */
  stats: Stats;
  /** 初始当前生命；省略时等于 `stats.maxHp`。`hp` 为 0 就是尸体。 */
  hp?: number;
  /** 是否为默认玩家角色；主角死亡时只通知 world，收尾由 world 回合决定。 */
  isDefaultPlayer?: boolean;
  items: readonly ItemDefinition[];
  /** 该角色能执行的行动；必须显式列出，不给默认值。 */
  actions: readonly ActionKind[];
};

/** 词缀：短名字 + 一句自然语言规则；展示与提示词统一为 `[名字]内容`。 */
export type Affix = {
  name: string;
  content: string;
};

/** Actor 的初始物品定义；创建后物化为 `items` 或 `stage_items` 行。 */
export type ItemDefinition = {
  /** 世界内稳定 key；行为与内容判定用它，不用展示名。 */
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  count?: number;
  /** 属性；可省略，未写出的字段按 0 归一。 */
  stats?: Partial<Stats>;
  /** 物品效果；必须显式声明，type 路由到 handler。 */
  effect: ItemEffect;
  /** 词缀；可省略，创建时归一化为空数组。 */
  affixes?: readonly Affix[];
  /** 物品能提供的动作；穿戴中才借给角色。可省略，创建时归一化为空数组。 */
  actions?: readonly ActionKind[];
  /** 材料来源；只有 `material` 可以声明，其它大类声明会被内容校验拒绝。 */
  source?: string;
};

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
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

/** 玩家对话审核覆盖四种说话动作；call 也按台词审核。 */
export type DialogueActionKind = "say" | "whisper" | "announce" | "call";

/** 审核拒绝的类别；允许时为空。 */
export type DialogueCategory = "immersion_break" | "out_of_world" | "prohibited" | "other";

/** 审核失败的技术原因；内容违规不属于 failure。 */
export type DialogueFailureKind =
  | "timeout"
  | "connection"
  | "api"
  | "invalid_verdict"
  | "judge_error";

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

export type AgentMemoryMessageState = {
  sequence: number;
  type: "system" | "human" | "ai" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
  metadata?: unknown;
  createdAt: string;
};

/**
 * 观察类记忆消息的 metadata。
 *
 * 观察回答「谁看到了什么」，因此只带当事人与场景标识，不带规则数值：
 * 剩余生命这类数值只写进公共消息、舞台记忆与当事人自己的观察文本。
 */
export type ObservationMetadata = {
  /** 记忆类别，取 `MEMORY_KINDS` 里的观察类值。 */
  kind: MemoryKind;
  /** 原始事件的可见范围；沟通观察会写，供快照阅读。 */
  visibility?: MessageVisibility;
  /** 沟通观察的具体事件类型：say / whisper / announce / call。 */
  communicationKind?: CommunicationKind;
  /** 沟通观察里真正说出口的台词；供审计定位，渲染时仍以 content 为准。 */
  dialogue?: string;
  stageId?: string;
  actorId?: string;
  sourceActorId?: string;
  attackerActorId?: string;
  targetActorId?: string;
  itemName?: string;
  targetStageId?: string;
  targetStageName?: string;
  targetAnchor?: string;
};

/** stage 自己记忆里的场景事件：`kind` 与 `stageId` 由写入方固定，调用方只说明事件类别。 */
export type StageEventMetadata = Omit<ObservationMetadata, "kind" | "visibility" | "stageId"> & {
  eventKind: string;
};

export type AgentMemoryState = {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  contextUsageRatio: number;
  messages: AgentMemoryMessageState[];
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

/** actor 去过哪些场景；只用于传送与地图，不参与普通移动权限。 */
export type StageVisitState = {
  actorId: string;
  stageId: string;
  firstVisitedAt: string;
  lastVisitedAt: string;
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
  /** 访问历史；用于地图、已访问候选与查看，不参与普通移动权限。 */
  visits: StageVisitState[];
};

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

export type ActorTurnResult = {
  ok: boolean;
  plan: ActorPlan | null;
  loopSuccess: boolean;
  state: GameState;
  /** 本次行动之后死亡阶段的结果；失败不回滚这次行动，但要让上层看得见。 */
  death?: DeathPhaseResult;
};

export type StageTurnResult = {
  ok: boolean;
  plan: StagePlan | null;
  loopSuccess: boolean;
  state: GameState;
};

export type WorldTurnResult = {
  ok: boolean;
  plan: WorldPlan | null;
  loopSuccess: boolean;
  state: GameState;
};

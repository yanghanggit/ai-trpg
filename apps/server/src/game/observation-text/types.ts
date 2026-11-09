import type { MemoryKind } from "../constants";
import type { ActionKind, CommunicationKind, ItemEventKind, MessageVisibility } from "../types";

/**
 * 观察与伤害文案的输入/输出形状：纯数据，不含任何渲染。
 *
 * 两条约定写在这里，免得每个 renderer 各说一遍：
 * - 观察回答「谁看到了什么」，metadata 只带当事人与场景标识，不带规则数值；
 * - 观察对象的投影只带 id（见 `ActorRef` / `StageRef`），名字必须由 `AddressLookup` 渲染。
 */

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
  /** 一次动作取走多件物品时用（目前只有搜刮尸体）。 */
  itemNames?: readonly string[];
  affixName?: string;
  witness?: boolean;
  targetStageId?: string;
  targetStageName?: string;
  targetAnchor?: string;
};

/** stage 自己记忆里的场景事件：`kind` 与 `stageId` 由写入方固定，调用方只说明事件类别。 */
export type StageEventMetadata = Omit<ObservationMetadata, "kind" | "visibility" | "stageId"> & {
  eventKind: string;
};

/**
 * 观察对象的最小投影：只带 id。
 *
 * 观察文本里的名字必须由 `AddressLookup` 渲染；这里不提供 name，
 * 新写的 renderer 想拼真名会在类型层直接编译失败。
 */
export type ActorRef = { id: string };

/** 场景的最小投影：`id` 进 metadata，`name` 进文案。 */
export type StageRef = { id: string; name: string };

/** 观察者范围：整个场景，或只有指定的当事人。 */
export type Audience =
  | { readonly type: "stage" }
  | { readonly type: "only"; readonly actorId: string };

/** 一次观察的落账内容：文本与结构化标注一起写进同一条 memory 消息。 */
export type ObservationView = { content: string; metadata: ObservationMetadata };

/**
 * 沟通观察的输入。
 *
 * 成员与同场景沟通动作对应：除公开宣告外都必须指定目标，
 * 「say 忘了带目标」在这里是不能表示的状态，因此不需要运行期校验。
 * 跨场景的 `call` 不经过场景广播，单独用 `CallObservation`。
 */
export type CommunicationObservation = { source: ActorRef; message: string } & (
  | { kind: Exclude<CommunicationKind, "announce" | "call">; target: ActorRef }
  | { kind: "announce" }
);

/** 跨场景传音只写给目标；发起人不在结构里，只能由台词自己披露。 */
export type CallObservation = {
  target: ActorRef;
  message: string;
};

/**
 * 查看他人行囊的观察输入。
 *
 * 清单只回给查看者自己的行动事实；目标与旁观者看到的只是「有人在翻看」，
 * 所以这条观察不带任何物品名。
 */
export type InspectObservation = { actor: ActorRef; target: ActorRef };

/**
 * 物品观察的输入。
 *
 * 成员与 `ItemEventKind` 对应：`target` 的有无由动作本身决定，不交给调用方记，
 * 于是文案里不再有「某人」这类兜底。
 */
export type ItemObservation = { actor: ActorRef } & (
  | { event: Extract<ItemEventKind, "steal" | "give">; itemName: string; target: ActorRef }
  | { event: "loot"; target: ActorRef; itemNames: readonly string[] }
  | {
      event: Extract<ItemEventKind, "use">;
      itemName: string;
      target?: ActorRef;
      targetStageName?: string;
      targetAnchor?: string;
    }
  | { event: "pickup"; itemName: string; anchorLabel: string }
);

/**
 * 伤害观察的输入：数值由结算方给出，文案只负责按行动与视角取舍。
 *
 * `strike` / `cleave` / `brawl` / `use` 都会造成伤害，但不是同一件事：标题与措词一律跟着动作走。
 */
export type DamageObservation = {
  action: Extract<ActionKind, "strike" | "cleave" | "brawl" | "use">;
  attacker: ActorRef;
  target: ActorRef & { maxHp: number };
  /** 本次动作用到的物品名；`strike` 必填，`use` 省略表示空手。 */
  itemName?: string;
  /** 词缀追加的伤害；默认效果省略。 */
  via?: "affix";
  damage: number;
  remainingHp: number;
};

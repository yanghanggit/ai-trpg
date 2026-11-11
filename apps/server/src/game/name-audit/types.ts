import type { CommunicationKind } from "../kernel/types";
import type { AgentMemoryMessageState, AgentMemoryState } from "../memory";

/**
 * 名字审计的输入、命中与报告形状。
 *
 * 审计是只读旁路：只消费已落账的记忆与称呼表，不改任何状态，也不调用 LLM。
 * 真名来自 `actors.name`，观察者的签名称呼来自 `actor_signature_names`，
 * 记忆来自 actor 的 `agent_memory_messages`；stage / world 自己的记忆是上帝视角，
 * 允许写名字，不在扫描范围。
 */

export type NameAuditActor = {
  id: string;
  name: string;
  /** 当前签名的 id；`currentSignature` 模式用它判断“现在是否仍用这个名字”。 */
  currentSignatureId: string;
};

export type NameAuditSignature = {
  id: string;
  actorId: string;
};

export type NameAuditSignatureName = {
  observerActorId: string;
  signatureId: string;
  name: string;
};

export type NameAuditInput = {
  actors: readonly NameAuditActor[];
  /** 包含已退场的签名；`ever` 模式靠它把旧名字归回 actor。 */
  signatures: readonly NameAuditSignature[];
  signatureNames: readonly NameAuditSignatureName[];
  /** 只消费 `ownerType === "actor"` 的记忆。 */
  memories: readonly AgentMemoryState[];
};

export type NameLeakScope = "ever" | "currentSignature";
export type NameLeakSeverity = "high" | "medium" | "low";
export type NameLeakPart = "content" | "tool_calls";

export type NameLeakOptions = {
  /**
   * `ever`（默认）：观察者曾经用这个 actor 的真名称呼过它就不报，历史记忆不会被误伤。
   * `currentSignature`：只看当前签名的名字，适合检查伪装 / 变身后的称呼。
   */
  nameScope?: NameLeakScope;
  /** 跳过的记忆类别；默认跳过 actor system prompt。 */
  skipKinds?: readonly string[];
  /** 只扫这些记忆类别；设置后优先于 `skipKinds`。 */
  onlyKinds?: readonly string[];
  /** 内容层豁免的名字（常用词、与地点/道具撞名的角色名等）。 */
  allowNames?: readonly string[];
  /** 命中片段的上下文半径，默认 24 个字符。 */
  excerptRadius?: number;
  /** 是否连 `toolCalls` 的 JSON 一起扫，默认 true。 */
  includeToolCalls?: boolean;
  /** 只扫这个时间点之后写入的消息；回合级审计用。 */
  since?: Date | string;
};

export type NameLeak = {
  observerActorId: string;
  observerName: string;
  /** 命中的真名。 */
  matchedName: string;
  /** 真名对应的 actor；同名角色会有多个。 */
  subjectActorIds: string[];
  severity: NameLeakSeverity;
  /** 沟通观察的事件类型；say / whisper / announce / call 才有。 */
  communicationKind: CommunicationKind | null;
  /** 命中位置是否落在该沟通观察结构化的 dialogue 字段内。 */
  inDialogue: boolean;
  messageSequence: number;
  messageType: AgentMemoryMessageState["type"];
  messageKind: string | null;
  part: NameLeakPart;
  excerpt: string;
};

/** 沟通观察缺台词结构时的告警；审计只报告，不补字段、不改文案。 */
export type NameAuditAlert = {
  code: "missing_dialogue_structure" | "unexpected_dialogue_structure";
  observerActorId: string;
  observerName: string;
  messageSequence: number;
  messageType: AgentMemoryMessageState["type"];
  messageKind: string | null;
  missing: string[];
  detail: string;
};

export type NameAuditResult = {
  leaks: NameLeak[];
  alerts: NameAuditAlert[];
};

export type NameLeakReport = {
  gameId: string;
  leaks: NameLeak[];
  alerts: NameAuditAlert[];
  checked: {
    actors: number;
    messages: number;
    nameRows: number;
  };
};

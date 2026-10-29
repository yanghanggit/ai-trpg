import type { Database } from "../db/pool";
import { type TraceContext, traceEvent } from "../debug/trace";
import type { Logger } from "../logging";
import { MEMORY_KINDS } from "./constants";
import { loadNameAuditInput } from "./persistence/name-audit";
import type { AgentMemoryMessageState, AgentMemoryState, CommunicationKind } from "./types";

/**
 * actor 记忆的名字泄漏审计。
 *
 * 只读：不写游戏状态，不调用 LLM。真名来自 `actors.name`，观察者的信念来自
 * `name_knowledge`（观察者 × 形象），记忆来自 actor 的 `agent_memory_messages`。
 * stage / world 自己的记忆是上帝视角，允许写名字，不在扫描范围。
 *
 * 默认跳过 system prompt：campaignSetting / profile 是内容层设定，可能刻意使用
 * 普通名词或历史人物名；需要连内容一起检查时显式关掉 skipKinds。
 */

export const ENV_NAME_AUDIT = "TRPG_AUDIT_NAMES";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_SKIP_KINDS = [MEMORY_KINDS.actorSystemPrompt];
const LOW_SEVERITY_KINDS = new Set<string>([
  MEMORY_KINDS.actorSystemPrompt,
  MEMORY_KINDS.actorOpeningBriefing,
]);
const MAX_RUNTIME_TRACE_EVENTS = 20;

/** 回合级审计只看最近的增量；留一点时钟余量，避免 DB 与应用时钟的毫秒差漏掉消息。 */
const RUNTIME_LOOKBACK_MS = 2000;

export type NameAuditActor = {
  id: string;
  name: string;
  /** 当前形象的 id；`currentPresentation` 模式用它判断“现在认不认识”。 */
  currentPresentationId: string;
};

export type NameAuditPresentation = {
  id: string;
  actorId: string;
};

export type NameAuditKnowledge = {
  observerActorId: string;
  presentationId: string;
  name: string;
};

export type NameAuditInput = {
  actors: readonly NameAuditActor[];
  /** 包含已退场的形象；`ever` 模式靠它把旧信念归回 actor。 */
  presentations: readonly NameAuditPresentation[];
  knowledge: readonly NameAuditKnowledge[];
  /** 只消费 `ownerType === "actor"` 的记忆。 */
  memories: readonly AgentMemoryState[];
};

export type NameLeakScope = "ever" | "currentPresentation";
export type NameLeakSeverity = "high" | "medium" | "low";
export type NameLeakForm = "reference" | "bare";
export type NameLeakPart = "content" | "tool_calls";

export type NameLeakOptions = {
  /**
   * `ever`（默认）：观察者曾经知道这个名字就不报，历史记忆不会被误伤。
   * `currentPresentation`：只认当前形象，适合检查伪装 / 变身后的识别泄漏。
   */
  beliefScope?: NameLeakScope;
  /** 跳过的记忆类别；默认跳过 actor system prompt。 */
  skipKinds?: readonly string[];
  /** 只扫这些记忆类别；设置后优先于 `skipKinds`。 */
  onlyKinds?: readonly string[];
  /** 内容层豁免的名字（常用词、与地点/物品撞名的角色名等）。 */
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
  /** 观察者对第一个未识别主体的当前信念；null 表示没记录过。 */
  belief: string | null;
  severity: NameLeakSeverity;
  form: NameLeakForm;
  /** 命中的名字同时是观察者给别人的称呼；可能是合理的同名碰撞。 */
  ambiguous: boolean;
  /** 沟通观察的事件类型；只有 say / whisper / announce 才有。 */
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
    knowledgeRows: number;
  };
};

/** `TRPG_AUDIT_NAMES=1/true/yes/on` 时打开回合级审计。 */
export function nameAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_NAME_AUDIT]?.trim().toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

/** 回合级的 `since`：留出 DB 与应用时钟的毫秒差。 */
export function nameAuditSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - RUNTIME_LOOKBACK_MS);
}

function metadataRecord(message: AgentMemoryMessageState): Record<string, unknown> | null {
  const metadata = message.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  return metadata as Record<string, unknown>;
}

function metadataKind(message: AgentMemoryMessageState): string | null {
  const kind = metadataRecord(message)?.kind;
  return typeof kind === "string" ? kind : null;
}

/** 只接受台词事件的三种类型；其余值视为结构错误，不做猜测。 */
function asCommunicationKind(value: unknown): CommunicationKind | null {
  return value === "say" || value === "whisper" || value === "announce" ? value : null;
}

function dialogueOf(metadata: Record<string, unknown> | null): string | null {
  const dialogue = metadata?.dialogue;
  return typeof dialogue === "string" && dialogue.length > 0 ? dialogue : null;
}

function messageSeverity(message: AgentMemoryMessageState, kind: string | null): NameLeakSeverity {
  if (message.type === "system" || (kind !== null && LOW_SEVERITY_KINDS.has(kind))) {
    return "low";
  }
  if (message.type === "ai" || kind === MEMORY_KINDS.compactedMemory) {
    return "medium";
  }
  // 引擎写入的 human 观察 / 反馈 / 拒绝与 tool 结果：本应已经按观察者脱敏。
  return "high";
}

function jsonText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function excerptOf(text: string, index: number, length: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

type SubjectGroup = {
  name: string;
  /** 观察者不知道真名的主体；同名角色可能多个。 */
  unknown: NameAuditActor[];
  belief: string | null;
  ambiguous: boolean;
};

function subjectGroups(input: {
  actors: readonly NameAuditActor[];
  observerId: string;
  beliefs: readonly NameAuditKnowledge[];
  beliefScope: NameLeakScope;
  presentationActor: ReadonlyMap<string, string>;
  allowNames: ReadonlySet<string>;
}): SubjectGroup[] {
  const beliefByPresentation = new Map<string, string>();
  for (const row of input.beliefs) {
    beliefByPresentation.set(row.presentationId, row.name);
  }
  const known = (subject: NameAuditActor): boolean =>
    input.beliefs.some(
      (row) =>
        row.name === subject.name &&
        (input.beliefScope === "currentPresentation"
          ? row.presentationId === subject.currentPresentationId
          : input.presentationActor.get(row.presentationId) === subject.id),
    );

  const byName = new Map<string, NameAuditActor[]>();
  for (const subject of input.actors) {
    if (subject.id === input.observerId) {
      continue;
    }
    if (subject.name.length === 0 || input.allowNames.has(subject.name)) {
      continue;
    }
    const list = byName.get(subject.name) ?? [];
    list.push(subject);
    byName.set(subject.name, list);
  }

  return [...byName.entries()]
    .map(([name, subjects]) => {
      const unknown = subjects.filter((subject) => !known(subject));
      return {
        name,
        unknown,
        belief: unknown[0]
          ? (beliefByPresentation.get(unknown[0].currentPresentationId) ?? null)
          : null,
        // 观察者用这个名字称呼别人：可能只是同名碰撞，报告里单独标记。
        ambiguous: input.beliefs.some((row) => row.name === name),
      };
    })
    .sort((a, b) => b.name.length - a.name.length);
}

function overlaps(mask: Uint8Array, start: number, length: number): boolean {
  for (let index = start; index < start + length; index += 1) {
    if (mask[index] === 1) {
      return true;
    }
  }
  return false;
}

function mark(mask: Uint8Array, start: number, length: number): void {
  for (let index = start; index < start + length; index += 1) {
    mask[index] = 1;
  }
}

/** 纯函数：给定 actor、信念与记忆，找出所有真名越界与结构告警。 */
export function findNameAudit(
  input: NameAuditInput,
  options: NameLeakOptions = {},
): NameAuditResult {
  const beliefScope = options.beliefScope ?? "ever";
  const skipKinds = options.skipKinds ?? DEFAULT_SKIP_KINDS;
  const onlyKinds = options.onlyKinds;
  const allowNames = new Set(options.allowNames ?? []);
  const excerptRadius = options.excerptRadius ?? 24;
  const includeToolCalls = options.includeToolCalls !== false;
  const sinceMs = options.since === undefined ? undefined : new Date(options.since).getTime();

  const presentationActor = new Map(
    input.presentations.map((presentation) => [presentation.id, presentation.actorId]),
  );
  const knowledgeByObserver = new Map<string, NameAuditKnowledge[]>();
  for (const row of input.knowledge) {
    const rows = knowledgeByObserver.get(row.observerActorId) ?? [];
    rows.push(row);
    knowledgeByObserver.set(row.observerActorId, rows);
  }
  const memoryByOwner = new Map<string, AgentMemoryState>();
  for (const memory of input.memories) {
    if (memory.ownerType === "actor") {
      memoryByOwner.set(memory.ownerId, memory);
    }
  }

  const leaks: NameLeak[] = [];
  const alerts: NameAuditAlert[] = [];
  const seen = new Set<string>();
  const seenAlerts = new Set<string>();

  for (const observer of input.actors) {
    const memory = memoryByOwner.get(observer.id);
    if (!memory) {
      continue;
    }
    const groups = subjectGroups({
      actors: input.actors,
      observerId: observer.id,
      beliefs: knowledgeByObserver.get(observer.id) ?? [],
      beliefScope,
      presentationActor,
      allowNames,
    });

    for (const message of memory.messages) {
      const createdAtMs = Date.parse(message.createdAt);
      if (sinceMs !== undefined && Number.isFinite(createdAtMs) && createdAtMs < sinceMs) {
        continue;
      }
      const metadata = metadataRecord(message);
      const kind = metadataKind(message);
      if (onlyKinds !== undefined) {
        if (kind === null || !onlyKinds.includes(kind)) {
          continue;
        }
      } else if (kind !== null && skipKinds.includes(kind)) {
        continue;
      }

      const isCommunication = kind === MEMORY_KINDS.communicationObservation;
      const isFeedback = kind === MEMORY_KINDS.actionFeedback;
      const dialogueCapable = isCommunication || isFeedback;
      const communicationKind = dialogueCapable
        ? asCommunicationKind(metadata?.communicationKind)
        : null;
      const dialogue = dialogueCapable ? dialogueOf(metadata) : null;
      const hasCommunicationKind = metadata?.communicationKind !== undefined;
      const hasDialogue = metadata?.dialogue !== undefined;
      const hasDialogueFields = hasCommunicationKind || hasDialogue;

      if (isCommunication) {
        const missing: string[] = [];
        if (communicationKind === null) {
          missing.push("communicationKind");
        }
        if (dialogue === null) {
          missing.push("dialogue");
        }
        if (missing.length > 0) {
          const key = `${observer.id}\u0000${message.sequence}\u0000missing`;
          if (!seenAlerts.has(key)) {
            seenAlerts.add(key);
            alerts.push({
              code: "missing_dialogue_structure",
              observerActorId: observer.id,
              observerName: observer.name,
              messageSequence: message.sequence,
              messageType: message.type,
              messageKind: kind,
              missing,
              detail: "沟通观察缺少结构化的台词信息；审计只报警，不补齐、不纠正",
            });
          }
        }
      } else if (isFeedback) {
        // 非台词动作的反馈本来就没有台词字段；只有带了一部分时才说明结构不完整。
        if (hasDialogueFields) {
          const missing: string[] = [];
          if (communicationKind === null) {
            missing.push("communicationKind");
          }
          if (dialogue === null) {
            missing.push("dialogue");
          }
          if (missing.length > 0) {
            const key = `${observer.id}\u0000${message.sequence}\u0000feedback-missing`;
            if (!seenAlerts.has(key)) {
              seenAlerts.add(key);
              alerts.push({
                code: "missing_dialogue_structure",
                observerActorId: observer.id,
                observerName: observer.name,
                messageSequence: message.sequence,
                messageType: message.type,
                messageKind: kind,
                missing,
                detail: "台词行动的行动反馈缺少结构化的台词信息；审计只报警，不补齐、不纠正",
              });
            }
          }
        }
      } else if (hasDialogueFields) {
        const key = `${observer.id}\u0000${message.sequence}\u0000unexpected`;
        if (!seenAlerts.has(key)) {
          seenAlerts.add(key);
          alerts.push({
            code: "unexpected_dialogue_structure",
            observerActorId: observer.id,
            observerName: observer.name,
            messageSequence: message.sequence,
            messageType: message.type,
            messageKind: kind,
            missing: [],
            detail: "非台词事件携带了台词字段；audit 只报警，不猜测台词归属",
          });
        }
      }

      if (groups.length === 0) {
        continue;
      }

      const parts: { part: NameLeakPart; text: string }[] = [
        { part: "content", text: message.content },
      ];
      if (includeToolCalls && message.toolCalls !== undefined) {
        parts.push({ part: "tool_calls", text: jsonText(message.toolCalls) });
      }

      for (const { part, text } of parts) {
        if (text.length === 0) {
          continue;
        }
        const dialogueStart =
          part === "content" && dialogue !== null ? text.lastIndexOf(dialogue) : -1;
        const taken = new Uint8Array(text.length);
        for (const group of groups) {
          let index = text.indexOf(group.name);
          while (index !== -1) {
            if (!overlaps(taken, index, group.name.length)) {
              mark(taken, index, group.name.length);
              // 已知名字也要占位：避免它内部更短的未知名被误报。
              if (group.unknown.length === 0) {
                index = text.indexOf(group.name, index + group.name.length);
                continue;
              }
              const key = `${observer.id}\u0000${message.sequence}\u0000${part}\u0000${group.name}`;
              if (!seen.has(key)) {
                seen.add(key);
                const severity = messageSeverity(message, kind);
                leaks.push({
                  observerActorId: observer.id,
                  observerName: observer.name,
                  matchedName: group.name,
                  subjectActorIds: group.unknown.map((subject) => subject.id),
                  belief: group.belief,
                  severity,
                  form: index > 0 && text[index - 1] === "@" ? "reference" : "bare",
                  ambiguous: group.ambiguous,
                  communicationKind,
                  inDialogue:
                    dialogue !== null &&
                    dialogueStart >= 0 &&
                    index >= dialogueStart &&
                    index < dialogueStart + dialogue.length,
                  messageSequence: message.sequence,
                  messageType: message.type,
                  messageKind: kind,
                  part,
                  excerpt: excerptOf(text, index, group.name.length, excerptRadius),
                });
              }
            }
            index = text.indexOf(group.name, index + group.name.length);
          }
        }
      }
    }
  }

  const order: Record<NameLeakSeverity, number> = { high: 0, medium: 1, low: 2 };
  leaks.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.observerName.localeCompare(b.observerName, "zh") ||
      a.messageSequence - b.messageSequence ||
      a.matchedName.localeCompare(b.matchedName, "zh"),
  );
  alerts.sort(
    (a, b) =>
      a.observerName.localeCompare(b.observerName, "zh") ||
      a.messageSequence - b.messageSequence ||
      a.code.localeCompare(b.code),
  );
  return { leaks, alerts };
}

/** 只要泄漏列表的便捷入口；结构告警用 `findNameAudit`。 */
export function findNameLeaks(input: NameAuditInput, options: NameLeakOptions = {}): NameLeak[] {
  return findNameAudit(input, options).leaks;
}

function countMessagesSince(
  memories: readonly AgentMemoryState[],
  since: Date | string | undefined,
): number {
  const sinceMs = since === undefined ? undefined : new Date(since).getTime();
  let count = 0;
  for (const memory of memories) {
    for (const message of memory.messages) {
      const createdAtMs = Date.parse(message.createdAt);
      if (sinceMs === undefined || !Number.isFinite(createdAtMs) || createdAtMs >= sinceMs) {
        count += 1;
      }
    }
  }
  return count;
}

export async function auditGameNameLeaks(
  db: Database,
  gameId: string,
  options: NameLeakOptions = {},
): Promise<NameLeakReport> {
  const input = await loadNameAuditInput(db, gameId);
  const result = findNameAudit(input, options);
  return {
    gameId,
    ...result,
    checked: {
      actors: input.actors.length,
      messages: countMessagesSince(input.memories, options.since),
      knowledgeRows: input.knowledge.length,
    },
  };
}

/**
 * 回合级审计：只扫 `since` 之后的新消息，发现一条写一条 trace + 日志，不阻断回合。
 *
 * 失败被吞掉：审计是旁路，不能让一条查询错误回滚已经落账的行动。
 */
export async function auditTurnNameLeaks(
  db: Database,
  gameId: string,
  since: Date,
  options: { logger?: Logger; trace?: TraceContext } = {},
): Promise<NameLeak[]> {
  try {
    const report = await auditGameNameLeaks(db, gameId, { since });
    const leaks = report.leaks.slice(0, MAX_RUNTIME_TRACE_EVENTS);
    for (const leak of leaks) {
      options.logger?.warn("名字泄漏", leak);
      await traceEvent(options.trace, { event: "name_leak", ...leak });
    }
    for (const alert of report.alerts.slice(0, MAX_RUNTIME_TRACE_EVENTS)) {
      options.logger?.warn("名字审计结构告警", alert);
      await traceEvent(options.trace, { event: "name_audit_alert", ...alert });
    }
    return leaks;
  } catch (error) {
    options.logger?.warn("名字审计失败", error);
    return [];
  }
}

/** 人读视图；CLI 的 `--text` 与排障时用。 */
export function renderNameLeakReport(report: NameLeakReport): string {
  const lines = [
    `# 名字审计 · ${report.gameId}`,
    `检查 ${report.checked.actors} 个 actor / ${report.checked.messages} 条消息 / ${report.checked.knowledgeRows} 条名字信念`,
  ];
  if (report.leaks.length === 0 && report.alerts.length === 0) {
    lines.push("", "未发现真名泄漏或结构告警。");
    return `${lines.join("\n")}\n`;
  }
  if (report.leaks.length > 0) {
    lines.push("", `发现 ${report.leaks.length} 条真名泄漏：`);
    for (const leak of report.leaks) {
      lines.push(
        "",
        `[${leak.severity}] ${leak.observerName} · #${leak.messageSequence} ${leak.messageKind ?? leak.messageType}${leak.part === "tool_calls" ? "（toolCalls）" : ""}${leak.communicationKind ? ` · ${leak.communicationKind}` : ""}${leak.inDialogue ? " · 台词内" : ""}`,
        `真名「${leak.matchedName}」${leak.form === "reference" ? "（@引用）" : ""}${leak.ambiguous ? "（疑似同名信念）" : ""}`,
        `  ${leak.excerpt}`,
      );
    }
  }
  if (report.alerts.length > 0) {
    lines.push("", `发现 ${report.alerts.length} 条结构告警：`);
    for (const alert of report.alerts) {
      lines.push(
        "",
        `[${alert.code}] ${alert.observerName} · #${alert.messageSequence} ${alert.messageKind ?? alert.messageType}`,
        `  ${alert.detail}${alert.missing.length > 0 ? `（缺少：${alert.missing.join("、")}）` : ""}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

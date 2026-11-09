import type { AgentMemoryMessageState, AgentMemoryState } from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import type { CommunicationKind } from "../types";
import { DEFAULT_SKIP_KINDS } from "./config";
import { subjectGroups } from "./subjects";
import type {
  NameAuditAlert,
  NameAuditInput,
  NameAuditResult,
  NameAuditSignatureName,
  NameLeak,
  NameLeakOptions,
  NameLeakPart,
  NameLeakSeverity,
} from "./types";

/**
 * 名字泄漏的匹配核心：纯函数，给定 actor、签名称呼与记忆，找出所有真名越界。
 *
 * 只报告，不纠正：命中给片段、严重度与是否落在结构化台词里，怎么处理由调用方决定。
 * 同一段文本里已匹配的名字会占位，避免它内部更短的未知名被误报。
 */

/** 低严重度：内容层设定与开局简报，本来就可能刻意出现普通名字。 */
const LOW_SEVERITY_KINDS = new Set<string>([
  MEMORY_KINDS.actorSystemPrompt,
  MEMORY_KINDS.actorOpeningBriefing,
]);

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

/** 只接受已知的台词事件类型；其余值视为结构错误，不做猜测。 */
function asCommunicationKind(value: unknown): CommunicationKind | null {
  return value === "say" || value === "whisper" || value === "announce" || value === "call"
    ? value
    : null;
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

/** 纯函数：给定 actor、签名称呼与记忆，找出所有真名越界与结构告警。 */
export function findNameAudit(
  input: NameAuditInput,
  options: NameLeakOptions = {},
): NameAuditResult {
  const nameScope = options.nameScope ?? "ever";
  const skipKinds = options.skipKinds ?? DEFAULT_SKIP_KINDS;
  const onlyKinds = options.onlyKinds;
  const allowNames = new Set(options.allowNames ?? []);
  const excerptRadius = options.excerptRadius ?? 24;
  const includeToolCalls = options.includeToolCalls !== false;
  const sinceMs = options.since === undefined ? undefined : new Date(options.since).getTime();

  const signatureActor = new Map(
    input.signatures.map((signature) => [signature.id, signature.actorId]),
  );
  const signatureNamesByObserver = new Map<string, NameAuditSignatureName[]>();
  for (const row of input.signatureNames) {
    const rows = signatureNamesByObserver.get(row.observerActorId) ?? [];
    rows.push(row);
    signatureNamesByObserver.set(row.observerActorId, rows);
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
      signatureNames: signatureNamesByObserver.get(observer.id) ?? [],
      nameScope,
      signatureActor,
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
                  severity,
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

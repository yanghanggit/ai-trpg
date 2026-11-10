import type { AgentMemoryMessageState } from "../memory";
import { MEMORY_KINDS } from "../memory/kinds";
import type { StageViewLogEntry, ViewerLogEntry } from "./types";

/**
 * 「感知日志」：从 memory 里挑出这个观察者真的接收到的那几类。
 *
 * 两个白名单故意分开写：actor 与 stage 能收到的类别不同，混用一份会静默放过
 * 对方收不到的消息（例如把 world 通知当成场景观察显示给演员）。
 */
const ACTOR_LOG_KINDS = new Set<string>([
  MEMORY_KINDS.environmentObservation,
  MEMORY_KINDS.actionObservation,
  MEMORY_KINDS.communicationObservation,
  MEMORY_KINDS.actionFeedback,
  MEMORY_KINDS.actionRejected,
  MEMORY_KINDS.planFailed,
  MEMORY_KINDS.identityUpdate,
  MEMORY_KINDS.routeRecall,
  MEMORY_KINDS.routeFailed,
  MEMORY_KINDS.compactedMemory,
]);

const STAGE_LOG_KINDS = new Set<string>([
  MEMORY_KINDS.stageOpeningSnapshot,
  MEMORY_KINDS.stageObservation,
  MEMORY_KINDS.worldDirective,
  MEMORY_KINDS.actionRejected,
  MEMORY_KINDS.planFailed,
]);

function metadataOf(metadata: unknown): Record<string, unknown> | undefined {
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : undefined;
}

function memoryKind(metadata: unknown): string {
  const kind = metadataOf(metadata)?.kind;
  return typeof kind === "string" ? kind : "";
}

function eventKindOf(metadata: unknown): string | undefined {
  const eventKind = metadataOf(metadata)?.eventKind;
  return typeof eventKind === "string" && eventKind.length > 0 ? eventKind : undefined;
}

/** actor 的日志：只有他自己收到的观察、反馈与认知更新。 */
export function actorLog(messages: readonly AgentMemoryMessageState[]): ViewerLogEntry[] {
  return messages.flatMap((message) => {
    if (message.type !== "human") {
      return [];
    }
    const kind = memoryKind(message.metadata);
    if (!ACTOR_LOG_KINDS.has(kind)) {
      return [];
    }
    return [
      {
        sequence: message.sequence,
        kind,
        content: message.content,
        createdAt: message.createdAt,
      },
    ];
  });
}

/** stage 的日志：场景事件与仲裁结论；场景事件额外带 `eventKind`。 */
export function stageLog(messages: readonly AgentMemoryMessageState[]): StageViewLogEntry[] {
  return messages.flatMap((message) => {
    if (message.type !== "human") {
      return [];
    }
    const kind = memoryKind(message.metadata);
    if (!STAGE_LOG_KINDS.has(kind)) {
      return [];
    }
    const eventKind = eventKindOf(message.metadata);
    return [
      {
        sequence: message.sequence,
        kind,
        ...(eventKind === undefined ? {} : { eventKind }),
        content: message.content,
        createdAt: message.createdAt,
      },
    ];
  });
}

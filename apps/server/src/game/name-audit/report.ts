import type { Database } from "../../db/pool";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { Logger } from "../../logging";
import type { AgentMemoryState } from "../memory";
import { loadNameAuditInput } from "../persistence/name-audit";
import { MAX_RUNTIME_TRACE_EVENTS } from "./config";
import { findNameAudit } from "./match";
import type { NameLeak, NameLeakOptions, NameLeakReport } from "./types";

/**
 * 审计的驱动与呈现：读一次输入、跑一遍匹配，产出报告或写进轨迹。
 *
 * 回合级审计是旁路：失败被吞掉，不能让一条查询错误回滚已经落账的行动。
 */

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
      nameRows: input.signatureNames.length,
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
    `检查 ${report.checked.actors} 个 actor / ${report.checked.messages} 条消息 / ${report.checked.nameRows} 条签名称呼`,
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
        `真名「${leak.matchedName}」`,
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

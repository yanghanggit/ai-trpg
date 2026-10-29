/**
 * 过程轨迹：一轮游戏的动作因果，按局分目录、按天追加 JSONL。
 *
 * 读者顺序是 agent → 人，所以它刻意做成「文件 + 事件」而不是「流 + 日志行」：
 * 跑完之后能被重新读取、跨局跨天聚合、用 rg/jq 直接分析；指标与正文在同一条事件里，
 * 不需要解析散文就能统计拒绝原因、失败阶段、工具使用。
 *
 * 三层各自一个所有者，互不替代：L0 状态在数据库（角色此刻知道什么），
 * 这里只记 L1 轨迹（这一轮发生了什么），L2 进程日志是 pino（启动、5xx、未捕获异常）。
 *
 * 目录：<repoRoot>/logs/trace/<gameSlug>/<YYYYMMDD>.jsonl，可用 `TRACE_DIR` 覆盖。
 * 落盘是尽力而为：写不进去只告警一次，不回滚游戏。
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { getBufferString } from "../llm/messages";
import type { ChatMessage, ToolCall, ToolDefinition, Usage } from "../llm/types";
import { findRepoRoot } from "./paths";

export const TRACE_VERSION = 1;
export const ENV_TRACE_SWITCH = "TRACE_ENABLED";
export const ENV_TRACE_DIR = "TRACE_DIR";

const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

/** 一局里的一条回合轨迹；`turnId` 贯穿该回合写入的所有事件。 */
export type TraceContext = {
  gameId: string;
  gameSlug: string;
  turnId: string;
  turnKind: TraceTurnKind;
};

export type TraceTurnKind =
  | "player"
  | "actor"
  | "stage"
  | "world"
  | "affix"
  | "death"
  | "appearance"
  | "drop"
  | "story";

/** 落盘的一行：公共字段 + 事件本体；新增事件只加成员，不改已有字段。 */
export type TraceLine = {
  v: number;
  at: string;
  gameId: string;
  gameSlug: string;
  turnId: string;
  turnKind: TraceTurnKind;
} & TraceEvent;

/**
 * 事件目录。判定标准仍是「复盘时能不能只靠它还原这一轮」：
 * 决策输入（llm_call）、决策输出（llm_result）、计划与应用（plan/applied）、
 * 拒绝原因（rejected）、子阶段结果（phase）、回合边界（turn_start/turn_end）。
 */
export type TraceEvent =
  | {
      event: "turn_start";
      label: string;
      actorId?: string;
      actorName?: string;
      stageId?: string;
      stageName?: string;
      contentVersion?: string;
    }
  | { event: "turn_end"; ok: boolean; loopSuccess?: boolean; detail?: unknown }
  | {
      event: "llm_call";
      round: number;
      /** 同一轮内的第几次发出；只有就地重试时才会 > 1。 */
      attempt?: number;
      loopId?: string;
      label: string;
      /** 这次请求实际使用的生成参数；model 为空表示由 provider 取默认值。 */
      settings: {
        model: string | null;
        thinking: boolean;
        toolChoice: string;
        reasoningEffort: string | null;
        temperature: number | null;
        maxTokens: number | null;
      };
      /** 工具定义全文（含描述与参数 schema），提示词调优时看的就是它。 */
      tools: readonly ToolDefinition[];
      inputMessage: string;
      messages: readonly ChatMessage[];
    }
  | {
      event: "llm_result";
      round: number;
      /** 同一轮内的第几次响应；只有就地重试时才会 > 1。 */
      attempt?: number;
      loopId?: string;
      label: string;
      finishReason?: string;
      content?: string;
      reasoningContent?: string;
      toolCalls?: readonly ToolCall[];
      usage?: Usage | null;
      elapsedMs?: number;
      contextUsageRatio?: number | null;
      error?: { kind: string; message: string; retryable: boolean };
    }
  | { event: "plan"; actions: unknown }
  | { event: "applied"; actionKind: string; feedback?: string; detail?: unknown }
  | {
      event: "identity_warning";
      code: "unseen_handle";
      handle: string;
      name: string;
      subjectActorId: string;
      detail: string;
    }
  | { event: "rejected"; code: string; reason: string }
  | {
      event: "name_leak";
      observerActorId: string;
      observerName: string;
      matchedName: string;
      subjectActorIds: readonly string[];
      severity: "high" | "medium" | "low";
      form: "reference" | "bare";
      communicationKind: "say" | "whisper" | "announce" | null;
      inDialogue: boolean;
      messageSequence: number;
      messageType: "system" | "human" | "ai" | "tool";
      messageKind: string | null;
      part: "content" | "tool_calls";
      excerpt: string;
    }
  | {
      event: "name_audit_alert";
      code: "missing_dialogue_structure" | "unexpected_dialogue_structure";
      observerActorId: string;
      observerName: string;
      messageSequence: number;
      messageType: "system" | "human" | "ai" | "tool";
      messageKind: string | null;
      missing: readonly string[];
      detail: string;
    }
  | {
      event: "dialogue_audit";
      allowed: boolean;
      reason: string;
      categories: readonly string[];
      failureKind?: string;
      auditId?: string;
      latencyMs: number;
      model: string;
      contentHash: string;
    }
  | {
      event: "observed";
      /** 观察去向：场景内广播 / stage 自己的记忆 / 只给当事人自己。 */
      via: "stage-actors" | "stage-memory" | "world-memory" | "self";
      kind: string;
      stageId?: string;
      sourceActorId?: string;
      /** 发起者已离开场景（如 move）时可能缺失；以 id 为准。 */
      sourceActorName?: string;
      /** 每个收件人实际看到的内容（当事人与旁观者措辞不同）。 */
      recipients?: readonly { actorId: string; actorName: string; content: string }[];
      /** 非广播去向（舞台记忆、自我观察）的正文。 */
      content?: string;
    }
  | {
      event: "phase";
      name: string;
      status: "ok" | "failed" | "skipped";
      actorName?: string;
      detail?: unknown;
    };

/** 未显式配置时默认开启；测试环境不落盘，避免污染语料并拖慢用例。 */
export function traceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_TRACE_SWITCH]?.trim().toLowerCase();
  if (raw !== undefined && raw !== "") {
    return !FALSE_VALUES.has(raw);
  }
  return env.NODE_ENV !== "test" && env.VITEST === undefined;
}

/** 轨迹根目录：固定落在仓库根，不依赖进程 cwd。 */
export function traceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_TRACE_DIR]?.trim();
  return override && override.length > 0
    ? resolve(override)
    : join(findRepoRoot(), "logs", "trace");
}

/** 开一条回合轨迹；`enabled` 仅供需要强制开关的调用方与测试使用。 */
export function createTurnTrace(input: {
  game: { id: string; slug: string };
  turnKind: TraceTurnKind;
  turnId?: string;
  enabled?: boolean;
}): TraceContext | undefined {
  if (!(input.enabled ?? traceEnabled())) {
    return undefined;
  }
  return {
    gameId: input.game.id,
    gameSlug: input.game.slug,
    turnId: input.turnId ?? randomUUID(),
    turnKind: input.turnKind,
  };
}

const UNSAFE_PATH = /[^0-9A-Za-z_.-]/g;
let warnedWriteFailure = false;
let appendQueue: Promise<void> = Promise.resolve();

function dayStamp(now: Date): string {
  const text = now.toISOString();
  return `${text.slice(0, 4)}${text.slice(5, 7)}${text.slice(8, 10)}`;
}

function traceFile(trace: TraceContext, now: Date): string {
  const slug = trace.gameSlug.replace(UNSAFE_PATH, "_") || trace.gameId.slice(0, 8);
  return join(traceRoot(), slug, `${dayStamp(now)}.jsonl`);
}

/**
 * 追加一条事件。
 *
 * 同进程内串行追加，避免并发回合把 JSONL 行写花；跨进程共写请按实例分目录。
 * 写失败只提示一次，不抛给游戏层——轨迹是旁路，不该让游戏回合失败。
 */
export async function traceEvent(
  trace: TraceContext | undefined,
  event: TraceEvent,
): Promise<void> {
  if (!trace) {
    return;
  }
  const now = new Date();
  const line = `${JSON.stringify({ v: TRACE_VERSION, at: now.toISOString(), ...trace, ...event })}\n`;
  const file = traceFile(trace, now);
  appendQueue = appendQueue.then(async () => {
    try {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, line, "utf8");
    } catch (error) {
      if (!warnedWriteFailure) {
        warnedWriteFailure = true;
        console.error(`[trace] 轨迹写入失败，后续同类错误不再提示: ${String(error)}`);
      }
    }
  });
  await appendQueue;
}

// ---- 读取与聚合（CLI 用；只读，不改任何状态） ----

export type TraceTurnSummary = {
  turnId: string;
  gameSlug: string;
  turnKind: TraceTurnKind;
  startedAt: string;
  label?: string;
  actorName?: string;
  stageName?: string;
  ok?: boolean;
  loopSuccess?: boolean;
  llmCalls: number;
  llmErrors: number;
  actions: string[];
  rejected?: string;
  failedPhases: string[];
  promptTokens: number;
  completionTokens: number;
};

export type TraceStats = {
  turns: number;
  ok: number;
  failed: number;
  events: Record<string, number>;
  rejections: Record<string, number>;
  llm: { calls: number; errors: number; promptTokens: number; completionTokens: number };
  tools: Record<string, number>;
  phases: Record<string, number>;
};

export type TraceQuery = {
  /** 只读某一局；省略时聚合所有局的轨迹。 */
  gameSlug?: string;
  /** 只读该日期（YYYYMMDD）之后（含）的文件。 */
  since?: string;
  limit?: number;
};

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** `20261028.jsonl[.gz]` → `20261028`；不是轨迹文件时返回 undefined。 */
function traceDayOf(fileName: string): string | undefined {
  const match = /^(\d{8})\.jsonl(\.gz)?$/.exec(fileName);
  return match?.[1];
}

/** 同一天里，归档的旧文件排在当天新追加的文件之前，保证读取顺序等于发生顺序。 */
function compareTraceFiles(a: string, b: string): number {
  const dayA = traceDayOf(a) ?? "";
  const dayB = traceDayOf(b) ?? "";
  if (dayA !== dayB) {
    return dayA < dayB ? -1 : 1;
  }
  const archivedA = a.endsWith(".gz") ? 0 : 1;
  const archivedB = b.endsWith(".gz") ? 0 : 1;
  return archivedA - archivedB;
}

function safeParseLine(line: string): TraceLine | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as TraceLine;
  } catch {
    return undefined;
  }
}

async function traceFiles(query: TraceQuery): Promise<string[]> {
  const root = traceRoot();
  const games = query.gameSlug ? [query.gameSlug.replace(UNSAFE_PATH, "_")] : await listDir(root);
  const files: string[] = [];
  for (const game of games) {
    const dir = join(root, game);
    const names = (await listDir(dir))
      .filter((name) => traceDayOf(name) !== undefined)
      .sort(compareTraceFiles);
    for (const name of names) {
      const day = traceDayOf(name);
      if (day === undefined || (query.since !== undefined && day < query.since)) {
        continue;
      }
      files.push(join(dir, name));
    }
  }
  return files;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function readLines(files: readonly string[]): Promise<TraceLine[]> {
  const lines: TraceLine[] = [];
  for (const file of files) {
    let raw: string;
    try {
      const buffer = await readFile(file);
      raw = file.endsWith(".gz")
        ? (await gunzipAsync(buffer)).toString("utf8")
        : buffer.toString("utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const parsed = safeParseLine(line);
      if (parsed) {
        lines.push(parsed);
      }
    }
  }
  return lines;
}

function summarize(lines: readonly TraceLine[]): TraceTurnSummary[] {
  const byTurn = new Map<string, TraceTurnSummary>();
  for (const line of lines) {
    let summary = byTurn.get(line.turnId);
    if (!summary) {
      summary = {
        turnId: line.turnId,
        gameSlug: line.gameSlug,
        turnKind: line.turnKind,
        startedAt: line.at,
        llmCalls: 0,
        llmErrors: 0,
        actions: [],
        failedPhases: [],
        promptTokens: 0,
        completionTokens: 0,
      };
      byTurn.set(line.turnId, summary);
    }
    switch (line.event) {
      case "turn_start":
        summary.label = line.label;
        summary.actorName = line.actorName;
        summary.stageName = line.stageName;
        break;
      case "turn_end":
        summary.ok = line.ok;
        summary.loopSuccess = line.loopSuccess;
        break;
      case "llm_call":
        summary.llmCalls += 1;
        break;
      case "llm_result":
        if (line.error) {
          summary.llmErrors += 1;
        }
        summary.promptTokens += line.usage?.promptTokens ?? 0;
        summary.completionTokens += line.usage?.completionTokens ?? 0;
        break;
      case "plan":
        summary.actions = planActionKinds(line.actions);
        break;
      case "applied":
        if (!summary.actions.includes(line.actionKind)) {
          summary.actions.push(line.actionKind);
        }
        break;
      case "rejected":
        summary.rejected = line.reason;
        break;
      case "phase":
        if (line.status === "failed") {
          summary.failedPhases.push(line.name);
        }
        break;
      default:
        break;
    }
  }
  return [...byTurn.values()];
}

function planActionKinds(actions: unknown): string[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.flatMap((action) =>
    typeof action === "object" && action !== null && "kind" in action
      ? [String((action as { kind: unknown }).kind)]
      : [],
  );
}

/** 回合摘要，按发生时间升序；`limit` 取最近 N 轮。 */
export async function listTurns(query: TraceQuery = {}): Promise<TraceTurnSummary[]> {
  const turns = summarize(await readLines(await traceFiles(query)));
  return query.limit === undefined ? turns : turns.slice(-query.limit);
}

/** 一整轮的完整事件链；找不到时返回空数组。 */
export async function readTurn(turnId: string, query: TraceQuery = {}): Promise<TraceLine[]> {
  const lines = await readLines(await traceFiles(query));
  return lines.filter((line) => line.turnId === turnId);
}

/** 最近 N 条事件（跨回合，按时间顺序），用于「刚刚发生了什么」。 */
export async function tailEvents(query: TraceQuery & { limit: number }): Promise<TraceLine[]> {
  const lines = await readLines(await traceFiles(query));
  return lines.slice(-query.limit);
}

/** 跨回合聚合：按事件、拒绝原因、阶段、工具统计，供 agent 做批量分析。 */
export async function traceStats(query: TraceQuery = {}): Promise<TraceStats> {
  const lines = await readLines(await traceFiles(query));
  const turns = summarize(lines);
  const stats: TraceStats = {
    turns: turns.length,
    ok: turns.filter((turn) => turn.ok === true).length,
    failed: turns.filter((turn) => turn.ok === false).length,
    events: {},
    rejections: {},
    llm: { calls: 0, errors: 0, promptTokens: 0, completionTokens: 0 },
    tools: {},
    phases: {},
  };
  const bump = (bucket: Record<string, number>, key: string): void => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  for (const line of lines) {
    bump(stats.events, line.event);
    if (line.event === "rejected") {
      bump(stats.rejections, line.code);
    }
    if (line.event === "phase") {
      bump(stats.phases, `${line.name}:${line.status}`);
    }
    if (line.event === "llm_result") {
      stats.llm.calls += 1;
      if (line.error) {
        stats.llm.errors += 1;
      }
      stats.llm.promptTokens += line.usage?.promptTokens ?? 0;
      stats.llm.completionTokens += line.usage?.completionTokens ?? 0;
      for (const call of line.toolCalls ?? []) {
        bump(stats.tools, call.function.name);
      }
    }
  }
  return stats;
}

export type TraceGcOptions = {
  /** 早于该日期（YYYYMMDD）的文件进入归档；当天与前一天的保留策略由调用方决定。 */
  before: string;
  gameSlug?: string;
  /** 直接删除而不是压缩归档。 */
  delete?: boolean;
  /** 只报告，不动文件。 */
  dryRun?: boolean;
};

export type TraceGcResult = {
  compressed: string[];
  deleted: string[];
  skipped: string[];
};

/**
 * 轨迹保留策略：老文件压缩为 `.jsonl.gz`（默认）或直接删除。
 *
 * 压缩是默认动作，因为轨迹的用途就是事后复读与跨局分析——删掉就没了；
 * 读取侧透明支持 `.jsonl.gz`，所以归档后 `trace list/show/stats` 照常工作。
 */
export async function gcTrace(options: TraceGcOptions): Promise<TraceGcResult> {
  const root = traceRoot();
  const result: TraceGcResult = { compressed: [], deleted: [], skipped: [] };
  const games = options.gameSlug
    ? [options.gameSlug.replace(UNSAFE_PATH, "_")]
    : await listDir(root);

  for (const game of games) {
    const dir = join(root, game);
    const names = await listDir(dir);
    for (const name of names) {
      const day = traceDayOf(name);
      if (day === undefined || day >= options.before) {
        continue;
      }
      const file = join(dir, name);
      if (options.delete) {
        if (!options.dryRun) {
          await unlink(file);
        }
        result.deleted.push(file);
        continue;
      }
      if (name.endsWith(".gz")) {
        result.skipped.push(file);
        continue;
      }
      if (!options.dryRun) {
        await writeFile(`${file}.gz`, await gzipAsync(await readFile(file)));
        await unlink(file);
      }
      result.compressed.push(file);
    }
    if (!options.dryRun && (await listDir(dir)).length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return result;
}

/** 一轮事件的人读视图：派生自同一份 JSONL，允许按需落盘审阅。 */
export function renderTurnText(events: readonly TraceLine[]): string {
  const first = events[0];
  if (!first) {
    return "";
  }
  const start = events.find((line) => line.event === "turn_start");
  const out: string[] = [
    `# ${start?.event === "turn_start" ? start.label : first.turnKind} · ${first.turnKind} · ${first.at}`,
    `game: ${first.gameSlug} (${first.gameId})  turn: ${first.turnId}`,
  ];
  if (start?.event === "turn_start") {
    const entity = [start.actorName, start.stageName].filter(Boolean).join(" @ ");
    if (entity) {
      out.push(`实体: ${entity}`);
    }
    if (start.contentVersion) {
      out.push(`内容版本: ${start.contentVersion}`);
    }
  }

  for (const line of events) {
    switch (line.event) {
      case "turn_start":
        break;
      case "llm_call": {
        const attempt = line.attempt === undefined ? "" : `（第 ${line.attempt} 次尝试）`;
        out.push("", `## 第 ${line.round} 轮 LLM 请求${attempt}`, settingsText(line.settings));
        out.push(`tools: ${line.tools.map((tool) => tool.function.name).join(", ") || "无"}`);
        if (line.inputMessage.length > 0) {
          out.push("", "### 本轮任务提示词", line.inputMessage);
        }
        out.push(
          "",
          "### 上下文消息",
          getBufferString(line.messages, {
            systemPrefix: "system",
            humanPrefix: "human",
            aiPrefix: "ai",
            toolPrefix: "tool",
            renderToolCalls: true,
          }),
        );
        break;
      }
      case "llm_result": {
        const attempt = line.attempt === undefined ? "" : `（第 ${line.attempt} 次尝试）`;
        const parts = [
          `finish: ${line.finishReason ?? "-"}`,
          line.usage
            ? `tokens ${line.usage.promptTokens}/${line.usage.completionTokens}`
            : "tokens -",
          line.elapsedMs === undefined ? undefined : `${line.elapsedMs}ms`,
          line.contextUsageRatio === undefined || line.contextUsageRatio === null
            ? undefined
            : `ctx ${Math.round(line.contextUsageRatio * 100)}%`,
        ].filter(Boolean);
        out.push("", `## 第 ${line.round} 轮 LLM 响应${attempt}`, parts.join(" | "));
        if (line.error) {
          out.push(
            `! 错误: [${line.error.kind}] ${line.error.message}${line.error.retryable ? "（可重试）" : ""}`,
          );
        }
        if (line.content) {
          out.push("", line.content);
        }
        if (line.reasoningContent) {
          out.push("", "### 推理", line.reasoningContent);
        }
        for (const call of line.toolCalls ?? []) {
          out.push(`[tool_call] ${call.function.name} ${call.function.arguments}`);
        }
        break;
      }
      case "plan":
        out.push("", "## 计划", JSON.stringify(line.actions, null, 2));
        break;
      case "applied":
        out.push("", `## 落账 · ${line.actionKind}`, line.feedback ?? "");
        break;
      case "rejected":
        out.push("", "## 被拒", `${line.code}: ${line.reason}`);
        break;
      case "name_leak":
        out.push(
          "",
          "## 名字泄漏",
          `[${line.severity}] ${line.observerName} · #${line.messageSequence} ${line.messageKind ?? line.messageType}${line.part === "tool_calls" ? "（toolCalls）" : ""}${line.communicationKind ? ` · ${line.communicationKind}` : ""}${line.inDialogue ? " · 台词内" : ""}`,
          `真名「${line.matchedName}」${line.form === "reference" ? "（@引用）" : ""}`,
          line.excerpt,
        );
        break;
      case "name_audit_alert":
        out.push(
          "",
          "## 名字审计结构告警",
          `[${line.code}] ${line.observerName} · #${line.messageSequence} ${line.messageKind ?? line.messageType}`,
          `${line.detail}${line.missing.length > 0 ? `（缺少：${line.missing.join("、")}）` : ""}`,
        );
        break;
      case "observed": {
        const header = [
          line.via,
          line.kind,
          line.sourceActorName ? `来源 ${line.sourceActorName}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        out.push("", "## 观察", header);
        if (line.content) {
          out.push(line.content);
        }
        for (const recipient of line.recipients ?? []) {
          out.push("", `→ ${recipient.actorName}`, recipient.content);
        }
        break;
      }
      case "phase":
        out.push(
          "",
          "## 子阶段",
          `${line.name}: ${line.status}${line.actorName ? ` (${line.actorName})` : ""}${phaseDetailText(line.detail)}`,
        );
        break;
      case "turn_end":
        out.push(
          "",
          "## 结束",
          `ok: ${line.ok}${line.loopSuccess === undefined ? "" : ` | loop: ${line.loopSuccess}`}`,
        );
        break;
    }
  }
  return `${out.join("\n")}\n`;
}

/** 子阶段 detail 展开；人读视图里要能看出落账了几条、为什么没落。 */
function phaseDetailText(detail: unknown): string {
  if (detail === undefined || detail === null) {
    return "";
  }
  if (typeof detail !== "object") {
    return `\n  ${String(detail)}`;
  }
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) {
    return "";
  }
  return `\n${entries.map(([key, value]) => `  ${key}: ${describeDetailValue(value)}`).join("\n")}`;
}

function describeDetailValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function settingsText(settings: {
  model: string | null;
  thinking: boolean;
  toolChoice: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxTokens: number | null;
}): string {
  return [
    `model: ${settings.model ?? "provider 默认"}`,
    `thinking: ${settings.thinking ? "on" : "off"}`,
    `toolChoice: ${settings.toolChoice}`,
    `reasoningEffort: ${settings.reasoningEffort ?? "-"}`,
    `temperature: ${settings.temperature ?? "-"}`,
    `maxTokens: ${settings.maxTokens ?? "-"}`,
  ].join(" | ");
}

/** 事件目录的自述视图：字段与语义以代码为准，这里只是给 CLI 打印。 */
export function traceSchema(): { version: number; dir: string; events: Record<string, string> } {
  return {
    version: TRACE_VERSION,
    dir: traceRoot(),
    events: {
      turn_start: "回合开始：谁、在哪、内容版本",
      turn_end: "回合结束：ok / loopSuccess",
      llm_call: "一次 LLM 请求：生成参数、工具定义、任务提示词、上下文消息",
      llm_result: "一次 LLM 响应：正文、推理、tool_calls、usage、耗时、错误",
      plan: "模型提交的计划动作列表",
      applied: "实际落账的动作与反馈",
      rejected: "计划被拒：code 可聚合，reason 为可读原因",
      name_leak: "actor 记忆中出现未获知的真名：观察者、真名、严重度、台词事件与上下文",
      name_audit_alert: "名字审计的结构告警：沟通观察缺少台词定位信息，或非沟通观察误带台词字段",
      observed: "观察写入：去向、发起者、每个收件人实际看到的正文",
      phase: "子阶段结果：death / drop / affix / appearance",
    },
  };
}

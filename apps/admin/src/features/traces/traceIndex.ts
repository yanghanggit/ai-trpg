/**
 * 轨迹摘要是契约里的 `unknown` 记录（服务端刻意不收窄文件语料）。
 *
 * 后台按字段读它，所以这里做一次显式收窄：少字段就整条丢掉，不猜、不补默认值——
 * 猜出来的形状会让「这一局跑了几回合」这种读数静默变错。
 */

export type TraceTurn = {
  turnId: string;
  gameSlug: string;
  turnKind: string;
  startedAt: string;
  ok: boolean | undefined;
  actorName: string | undefined;
  stageName: string | undefined;
  llmCalls: number;
  llmErrors: number;
  actions: string[];
  rejected: string | undefined;
  failedPhases: string[];
  promptTokens: number;
  completionTokens: number;
};

function stringOf(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberOf(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArrayOf(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** 收窄一条轨迹摘要；缺主键的返回 `undefined`，由调用方过滤掉。 */
export function parseTraceTurn(raw: Record<string, unknown>): TraceTurn | undefined {
  const turnId = stringOf(raw, "turnId");
  const gameSlug = stringOf(raw, "gameSlug");
  const turnKind = stringOf(raw, "turnKind");
  const startedAt = stringOf(raw, "startedAt");
  if (
    turnId === undefined ||
    gameSlug === undefined ||
    turnKind === undefined ||
    startedAt === undefined ||
    startedAt.length === 0
  ) {
    return undefined;
  }

  const ok = raw.ok;
  return {
    turnId,
    gameSlug,
    turnKind,
    startedAt,
    ok: typeof ok === "boolean" ? ok : undefined,
    actorName: stringOf(raw, "actorName"),
    stageName: stringOf(raw, "stageName"),
    llmCalls: numberOf(raw, "llmCalls"),
    llmErrors: numberOf(raw, "llmErrors"),
    actions: stringArrayOf(raw, "actions"),
    rejected: stringOf(raw, "rejected"),
    failedPhases: stringArrayOf(raw, "failedPhases"),
    promptTokens: numberOf(raw, "promptTokens"),
    completionTokens: numberOf(raw, "completionTokens"),
  };
}

/** 一行事件：阅览器只认「事件名 + 时间」，其余原样给出去看。 */
export type TraceEvent = {
  /** 这一回合里的第几条（0 起）：文件里的原顺序，也是渲染时的稳定键。 */
  seq: number;
  event: string;
  at: string;
  raw: Record<string, unknown>;
};

/**
 * 收窄一行事件；缺事件名才丢掉。
 *
 * 时间是展示用的：写坏了就留空、显示成「—」，但不能因为它把整行藏起来——
 * 阅览器的职责是把文件里的行如实呈现出来。
 */
export function parseTraceEvent(raw: Record<string, unknown>, seq = 0): TraceEvent | undefined {
  const event = stringOf(raw, "event");
  if (event === undefined) {
    return undefined;
  }
  return { seq, event, at: stringOf(raw, "at") ?? "", raw };
}

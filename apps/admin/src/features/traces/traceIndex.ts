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

export type TraceStats = {
  turns: number;
  ok: number;
  failed: number;
  llm: { calls: number; errors: number; promptTokens: number; completionTokens: number };
  /** 拒绝原因按次数降序；只用来在首页列「最常见的几步为什么被拒」。 */
  rejections: [string, number][];
};

/** 收窄跨回合统计；缺字段按 0 处理，读数宁可低也不假装知道。 */
export function parseTraceStats(raw: Record<string, unknown>): TraceStats {
  const llm =
    typeof raw.llm === "object" && raw.llm !== null ? (raw.llm as Record<string, unknown>) : {};
  const rejections =
    typeof raw.rejections === "object" && raw.rejections !== null
      ? (raw.rejections as Record<string, unknown>)
      : {};

  return {
    turns: numberOf(raw, "turns"),
    ok: numberOf(raw, "ok"),
    failed: numberOf(raw, "failed"),
    llm: {
      calls: numberOf(llm, "calls"),
      errors: numberOf(llm, "errors"),
      promptTokens: numberOf(llm, "promptTokens"),
      completionTokens: numberOf(llm, "completionTokens"),
    },
    rejections: Object.entries(rejections)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort((left, right) => right[1] - left[1]),
  };
}

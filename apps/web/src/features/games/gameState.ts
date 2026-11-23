/**
 * `state` 在契约里还是 `unknown`（服务端的内部投影，尚未逐个字段定型）。
 *
 * 客户端只取入口页与占位页要显示的几个字段，读不到就当没有——不猜结构、
 * 不在页面里散落类型断言。
 */

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null ? (value as JsonObject) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

export type GameFacts = {
  name?: string;
  slug?: string;
  status?: string;
  version?: number;
  contentKey?: string;
  worldName?: string;
  stageCount?: number;
  messageCount?: number;
};

export function readGameFacts(state: unknown): GameFacts {
  const root = asObject(state);
  const game = asObject(root?.game);
  const world = asObject(root?.world);

  const facts: GameFacts = {
    name: asString(game?.name),
    slug: asString(game?.slug),
    status: asString(game?.status),
    version: asNumber(game?.version),
    contentKey: asString(world?.contentKey),
    worldName: asString(world?.name),
    stageCount: asLength(world?.stages),
    messageCount: asLength(root?.messages),
  };

  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as GameFacts;
}

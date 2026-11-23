import type { GamePageData } from "./types";

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

function stageNames(world: JsonObject | undefined): string[] {
  const stages = world?.stages;
  if (!Array.isArray(stages)) {
    return [];
  }
  return stages.flatMap((stage) => {
    const name = asString(asObject(stage)?.name);
    return name === undefined ? [] : [name];
  });
}

/**
 * `state` → 页面数据。契约里 `state` 还是 `unknown`，所以取字段一律带兜底：
 * 服务器换了结构，页面渲染成空而不是崩掉。
 */
export function adaptGameState(state: unknown, slug: string): GamePageData {
  const root = asObject(state);
  const game = asObject(root?.game);
  const world = asObject(root?.world);
  const messages = root?.messages;

  return {
    slug: asString(game?.slug) ?? slug,
    name: asString(game?.name),
    status: asString(game?.status),
    version: asNumber(game?.version),
    worldName: asString(world?.name),
    contentKey: asString(world?.contentKey),
    stages: stageNames(world),
    messageCount: Array.isArray(messages) ? messages.length : 0,
  };
}

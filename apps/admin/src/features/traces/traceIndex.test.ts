import { describe, expect, it } from "vitest";
import { parseTraceTurn } from "./traceIndex";

describe("parseTraceTurn", () => {
  it("缺主键时整条丢掉", () => {
    expect(parseTraceTurn({ turnId: "t1", gameSlug: "bell", turnKind: "actor" })).toBeUndefined();
    expect(parseTraceTurn({})).toBeUndefined();
  });

  it("可选字段按类型收窄，不猜默认值", () => {
    const parsed = parseTraceTurn({
      turnId: "t1",
      gameSlug: "bell",
      turnKind: "actor",
      startedAt: "2026-01-01T00:00:00.000Z",
      ok: "yes",
      actions: ["看", 42],
      llmCalls: "3",
    });

    expect(parsed?.ok).toBeUndefined();
    expect(parsed?.actions).toEqual(["看"]);
    expect(parsed?.llmCalls).toBe(0);
  });
});

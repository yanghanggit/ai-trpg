import { describe, expect, it } from "vitest";
import { parseTraceEvent, parseTraceTurn } from "./traceIndex";

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

describe("parseTraceEvent", () => {
  it("缺事件名才丢掉；时间坏了留空照常显示", () => {
    expect(parseTraceEvent({ at: "2026-01-01T00:00:00.000Z" })).toBeUndefined();
    const broken = parseTraceEvent({ event: "turn_start", at: 1 });
    expect(broken?.at).toBe("");
  });

  it("保留原始字段与次序，供事件面板原样展开", () => {
    const raw = { event: "turn_start", at: "2026-01-01T00:00:00.000Z", label: "开场" };
    expect(parseTraceEvent(raw, 3)).toEqual({ seq: 3, event: "turn_start", at: raw.at, raw });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTurn, type TraceContext } from "../src/debug/trace";
import { runIncrementalPhase } from "../src/game/incremental";

const trace: TraceContext = {
  gameId: "00000000-0000-4000-8000-000000000000",
  gameSlug: "incremental-test",
  turnId: "11111111-1111-4111-8111-111111111111",
  turnKind: "actor",
};

describe("incremental phase", () => {
  let dir = "";
  const previous = process.env.TRACE_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-trpg-incremental-"));
    process.env.TRACE_DIR = dir;
  });

  afterEach(async () => {
    if (previous === undefined) {
      delete process.env.TRACE_DIR;
    } else {
      process.env.TRACE_DIR = previous;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("records ok / skipped and never rewrites the outcome", async () => {
    const ok = await runIncrementalPhase({ name: "affix", trace }, async () => ({
      kind: "applied",
      actorName: "角色.甲",
      detail: { amount: 42 },
    }));
    const skipped = await runIncrementalPhase({ name: "affix", trace }, async () => ({
      kind: "noop",
      reason: "没有目标",
    }));

    expect(ok).toBe("ok");
    expect(skipped).toBe("skipped");
    const phases = (await readTurn(trace.turnId)).filter((line) => line.event === "phase");
    expect(phases.map((line) => line.event === "phase" && line.status)).toEqual(["ok", "skipped"]);
  });

  it("turns a thrown error into a failed phase without throwing", async () => {
    const status = await runIncrementalPhase({ name: "affix", trace }, async () => {
      throw new Error("模拟缺少 API key");
    });

    expect(status).toBe("failed");
    const phases = (await readTurn(trace.turnId)).filter((line) => line.event === "phase");
    expect(phases).toHaveLength(1);
    const [phase] = phases;
    expect(phase?.event).toBe("phase");
    if (phase?.event === "phase") {
      expect(phase.status).toBe("failed");
      expect(phase.detail).toMatchObject({ reason: "模拟缺少 API key" });
    }
  });

  it("keeps later phases independent when an earlier one fails", async () => {
    await runIncrementalPhase({ name: "affix", trace }, async () => {
      throw new Error("第一个物品失败");
    });
    const second = await runIncrementalPhase({ name: "affix", trace }, async () => ({
      kind: "applied",
    }));

    expect(second).toBe("ok");
    const statuses = (await readTurn(trace.turnId))
      .filter((line) => line.event === "phase")
      .map((line) => (line.event === "phase" ? line.status : ""));
    expect(statuses).toEqual(["failed", "ok"]);
  });
});

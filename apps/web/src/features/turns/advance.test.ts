import { describe, expect, it } from "vitest";
import type { ActionOrder } from "../action-order/useActionOrder";
import { type AdvancePort, advanceOnce, roundComplete, stageOfActor } from "./advance";
import type { TurnRequest } from "./api";
import { type TurnJob, TurnJobFailure } from "./turnJob";

function entry(actorName: string, control: "agent" | "player", turnsTaken: number, alive = true) {
  return {
    actorId: `id-${actorName}`,
    actorName,
    position: 1,
    agility: 5,
    turnsTaken,
    control,
    alive,
  };
}

function order(
  entries: ReturnType<typeof entry>[],
  next: ReturnType<typeof entry> | null,
  gameVersion = 3,
): ActionOrder {
  return {
    id: "order-1",
    status: "active",
    createdAt: "2026-01-02T03:04:05.000Z",
    completedAt: null,
    gameVersion,
    entries,
    nextActor:
      next === null
        ? null
        : {
            position: next.position,
            actorId: next.actorId,
            actorName: next.actorName,
            control: next.control,
          },
  };
}

/** 一个记下所有请求、按剧本回顺位的端口。 */
function makePort(script: {
  orders: (ActionOrder | null)[];
  stages?: Record<string, string[]>;
}): AdvancePort & { requests: TurnRequest[] } {
  const requests: TurnRequest[] = [];
  let read = 0;
  return {
    requests,
    readOrder: async () => {
      const value = script.orders[Math.min(read, script.orders.length - 1)] ?? null;
      read += 1;
      return value;
    },
    readStageMap: async () => script.stages ?? {},
    runTurn: async (request) => {
      requests.push(request);
      return { jobId: "job-1" } as TurnJob;
    },
  };
}

describe("roundComplete", () => {
  it("活人计数齐平且不为零才算走完一轮", () => {
    expect(roundComplete(null)).toBe(false);
    expect(roundComplete({ entries: [entry("a", "agent", 0), entry("b", "agent", 0)] })).toBe(
      false,
    );
    expect(roundComplete({ entries: [entry("a", "agent", 1), entry("b", "agent", 0)] })).toBe(
      false,
    );
    expect(roundComplete({ entries: [entry("a", "agent", 1), entry("b", "agent", 1)] })).toBe(true);
    // 死人不挡路：他停在旧计数上，不影响「这一轮走完」。
    expect(
      roundComplete({
        entries: [entry("a", "agent", 2), entry("b", "agent", 2), entry("c", "agent", 0, false)],
      }),
    ).toBe(true);
  });
});

describe("stageOfActor", () => {
  it("按名字找舞台；找不到就是没这个人在任何舞台上", () => {
    expect(stageOfActor({ 炉厅: ["温娜", "戈特"], 后院: [] }, "戈特")).toBe("炉厅");
    expect(stageOfActor({ 炉厅: ["温娜"] }, "无名旅人")).toBeUndefined();
  });
});

describe("advanceOnce", () => {
  it("没有顺位就先要一条，不瞎推", async () => {
    const port = makePort({ orders: [null] });
    expect(await advanceOnce(port)).toEqual({ kind: "no-order" });
    expect(port.requests).toEqual([]);
  });

  it("轮到玩家就停下，把决定交回界面", async () => {
    const player = entry("无名旅人", "player", 0);
    const port = makePort({ orders: [order([player], player)] });
    expect(await advanceOnce(port)).toEqual({ kind: "player", actorName: "无名旅人" });
    expect(port.requests).toEqual([]);
  });

  it("agent 回合：推它、再推它所在舞台；一轮走完补 world", async () => {
    const npc = entry("戈特", "agent", 0);
    const port = makePort({
      // 第一次读：推进前；第二次读：判断这一轮是否走完。
      orders: [order([npc], npc), order([entry("戈特", "agent", 1)], null)],
      stages: { 炉厅: ["戈特", "温娜"] },
    });

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc", "stage", "world"] });
    expect(port.requests).toEqual([
      // 带视图版本：执行时比对，过期就拒。
      { kind: "npc", actor: "戈特", expectedVersion: 3 },
      // 舞台回合不带版本：上一回合已经改过世界。
      { kind: "stage", stage: "炉厅" },
      { kind: "world", expectedVersion: undefined },
    ]);
  });

  it("视图过期就重读重算一次，不是这一回合的失败", async () => {
    const npc = entry("戈特", "agent", 0);
    const stale = entry("温娜", "agent", 0);
    let attempt = 0;
    const requests: TurnRequest[] = [];
    const port: AdvancePort = {
      readOrder: async () =>
        // 第一次读到旧版本（npc 已换人），重读之后才是真的下一位。
        attempt === 0 ? order([npc], npc, 3) : order([npc, stale], stale, 4),
      readStageMap: async () => ({}),
      runTurn: async (request) => {
        requests.push(request);
        attempt += 1;
        if (attempt === 1) {
          // 服务端给的是独立错误码 stale_view，客户端按码分支。
          throw new TurnJobFailure("stale_view", "视图已过期: 读到的是 version 3，当前 4");
        }
        return { jobId: "job-1" } as TurnJob;
      },
    };

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc"] });
    // 第二次用的是重读后的版本。
    expect(requests).toEqual([
      { kind: "npc", actor: "戈特", expectedVersion: 3 },
      { kind: "npc", actor: "温娜", expectedVersion: 4 },
    ]);
  });

  it("别的失败原样抛出：不把「已有回合在跑」当过期来重试", async () => {
    const npc = entry("戈特", "agent", 0);
    const port = makePort({ orders: [order([npc], npc)] });
    const failing: AdvancePort = {
      ...port,
      runTurn: async () => {
        throw new TurnJobFailure("invalid_state", "这一局已有回合在跑");
      },
    };
    await expect(advanceOnce(failing)).rejects.toThrow("已有回合在跑");
  });

  it("还没轮到所有人时不推 world；不在任何舞台上的 actor 跳过舞台回合", async () => {
    const npc = entry("戈特", "agent", 0);
    const port = makePort({
      orders: [
        order([npc], npc),
        order([entry("戈特", "agent", 1), entry("温娜", "agent", 0)], entry("温娜", "agent", 0)),
      ],
      stages: {},
    });

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc"] });
    expect(port.requests.map((request) => request.kind)).toEqual(["npc"]);
  });
});

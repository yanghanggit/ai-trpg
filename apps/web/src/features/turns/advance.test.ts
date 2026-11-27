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

/** 一个舞台的在场名单：id 由名字拼出来，测的是「按 id 定位」这件事本身。 */
function stage(name: string, actors: string[]) {
  return {
    id: `stage-${name}`,
    name,
    actors: actors.map((actor) => ({ id: `id-${actor}`, name: actor })),
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
    clock: 4,
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
  stages?: ReturnType<typeof stage>[];
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
    readStageMap: async () => script.stages ?? [],
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
  it("按 actorId 找舞台；找不到就是没这个人在任何舞台上", () => {
    const stages = [stage("炉厅", ["温娜", "戈特"]), stage("后院", [])];
    expect(stageOfActor(stages, "id-戈特")?.name).toBe("炉厅");
    expect(stageOfActor(stages, "id-无名旅人")).toBeUndefined();
  });

  it("同名角色分处两个舞台：按 id 各归各家，不取第一个", () => {
    const stages = [
      { id: "s1", name: "炉厅", actors: [{ id: "a-2", name: "戈特" }] },
      { id: "s2", name: "后院", actors: [{ id: "a-1", name: "戈特" }] },
    ];
    expect(stageOfActor(stages, "a-1")?.id).toBe("s2");
    expect(stageOfActor(stages, "a-2")?.id).toBe("s1");
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

  it("move 过之后推的是他出手那一处（A），不是到达的那一处（B）", async () => {
    const npc = entry("戈特", "agent", 0);
    const from = stage("炉厅", ["戈特"]);
    const to = stage("后院", ["戈特"]);
    const port = makePort({
      orders: [order([npc], npc), order([entry("戈特", "agent", 1)], null)],
    });
    // 名单在回合之前读：读到 A；回合里他走到 B，此后再读就是 B。
    let reads = 0;
    port.readStageMap = async () => {
      reads += 1;
      return reads === 1 ? [from] : [to];
    };

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc", "stage", "world"] });
    expect(port.requests).toContainEqual({ kind: "stage", stage: from.id, stageName: from.name });
    expect(port.requests).not.toContainEqual({ kind: "stage", stage: to.id, stageName: to.name });
  });

  it("agent 回合：推它、再推他动手时所在的舞台；一轮走完补 world", async () => {
    const npc = entry("戈特", "agent", 0);
    const port = makePort({
      // 第一次读：推进前；第二次读：判断这一轮是否走完。
      orders: [order([npc], npc), order([entry("戈特", "agent", 1)], null)],
      stages: [stage("炉厅", ["戈特", "温娜"])],
    });

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc", "stage", "world"] });
    expect(port.requests).toEqual([
      // 带视图版本：执行时比对，过期就拒。
      { kind: "npc", actor: "戈特", expectedVersion: 3 },
      // 舞台回合不带版本：上一回合已经改过世界。定位用 id，名字只为显示。
      { kind: "stage", stage: "stage-炉厅", stageName: "炉厅" },
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
      readStageMap: async () => [],
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
      // 名单里没有他：只推 npc，不推舞台。
      stages: [stage("炉厅", ["温娜"])],
    });

    expect(await advanceOnce(port)).toEqual({ kind: "advanced", steps: ["npc"] });
    expect(port.requests.map((request) => request.kind)).toEqual(["npc"]);
  });
});

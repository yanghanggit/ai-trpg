import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerAction } from "./api";
import { isTerminalJob, outcomeOf, type TurnJob } from "./turnJob";
import { useStartTurn } from "./useTurnJob";

function job(overrides: Partial<TurnJob> = {}): TurnJob {
  const now = "2026-01-02T03:04:05.000Z";
  return {
    jobId: "job-1",
    kind: "turn.actor.player",
    queue: "turns",
    status: "pending",
    serializationKey: "turn:g",
    attempts: 0,
    maxAttempts: 1,
    error: null,
    errorCode: null,
    progress: null,
    cancelRequested: false,
    runAt: now,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    result: null,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 取请求地址：openapi-fetch 有时给字符串、有时给 Request。 */
function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

/** 按调用次序回放作业快照；用完之后一直停在最后一份。 */
function stubFetchSequence(snapshots: TurnJob[]) {
  let index = 0;
  const fetchMock = vi.fn(async () => {
    const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
    index += 1;
    return new Response(JSON.stringify({ job: snapshot }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("作业终态", () => {
  it("只有三种终态会停下轮询", () => {
    expect(isTerminalJob(job({ status: "pending" }))).toBe(false);
    expect(isTerminalJob(job({ status: "running" }))).toBe(false);
    expect(isTerminalJob(job({ status: "succeeded" }))).toBe(true);
    expect(isTerminalJob(job({ status: "failed" }))).toBe(true);
    expect(isTerminalJob(job({ status: "canceled" }))).toBe(true);
  });

  it("失败码取作业留下的那个，不在客户端重新解释", () => {
    expect(outcomeOf(job({ status: "succeeded" }))).toMatchObject({ ok: true });
    expect(
      outcomeOf(job({ status: "failed", errorCode: "stale_view", error: "视图已过期" })),
    ).toMatchObject({ ok: false, code: "stale_view", message: "视图已过期" });
    // 取消没留错误文本时也要有可读的一句话。
    expect(outcomeOf(job({ status: "canceled" }))).toMatchObject({
      ok: false,
      code: "job_canceled",
    });
  });

  it("动作类型来自契约，不是客户端抄的联合", () => {
    const action: PlayerAction = { kind: "wait" };
    expect(action.kind).toBe("wait");
  });
});

describe("useStartTurn", () => {
  it("入队与第一次轮询之间用入队快照顶上，仍算在跑", async () => {
    // 读作业这一步失败：没有轮询结果可用，只能看入队返回的那份。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/turns/npc")) {
          return new Response(JSON.stringify({ job: job({ status: "pending" }) }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new TypeError("network down");
      }),
    );

    const { result } = renderHook(() => useStartTurn("g", { intervalMs: 10 }), { wrapper });

    await act(async () => {
      await result.current.start({ kind: "npc", actor: "守烬人" });
    });

    // 入队成功、轮询没成：页面既不能把它当「跑完了」，也不能当「没开始」。
    expect(result.current.job).toMatchObject({ status: "pending" });
    expect(result.current.isRunning).toBe(true);
  });

  it("轮询到终态就停下，并且只通知一次", async () => {
    const terminal = job({ status: "succeeded", updatedAt: "2026-01-02T03:04:09.000Z" });
    const fetchMock = stubFetchSequence([
      job({ status: "running", updatedAt: "2026-01-02T03:04:06.000Z" }),
      terminal,
    ]);
    const onTerminal = vi.fn();

    const { result } = renderHook(() => useStartTurn("g", { onTerminal, intervalMs: 10 }), {
      wrapper,
    });

    const enqueued = job({ status: "pending" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/turns/npc")) {
          return new Response(JSON.stringify({ job: enqueued }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        }
        return (fetchMock as unknown as (i: RequestInfo | URL) => Promise<Response>)(input);
      }),
    );

    await act(async () => {
      const started = await result.current.start({ kind: "npc", actor: "守烬人" });
      expect(started.jobId).toBe("job-1");
    });

    await waitFor(() => expect(onTerminal).toHaveBeenCalledTimes(1));
    expect(onTerminal.mock.calls[0]?.[0]).toMatchObject({ status: "succeeded" });
    expect(result.current.isRunning).toBe(false);

    // 终态之后不再读：等一会儿，读取次数不变。
    const readsAfterTerminal = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchMock.mock.calls.length).toBe(readsAfterTerminal);
  });
});

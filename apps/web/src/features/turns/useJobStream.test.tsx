import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnJob } from "./turnJob";
import { useJobStream } from "./useJobStream";

function job(jobId: string, status: TurnJob["status"], updatedAt: string): TurnJob {
  return {
    jobId,
    kind: "turn.actor.player",
    queue: "turns",
    status,
    serializationKey: "turn:g",
    attempts: 0,
    maxAttempts: 1,
    error: null,
    errorCode: null,
    progress: null,
    cancelRequested: false,
    runAt: updatedAt,
    startedAt: null,
    finishedAt: null,
    createdAt: updatedAt,
    updatedAt,
    result: null,
  };
}

type Listener = (event: Event) => void;

/** jsdom 没有 EventSource：按浏览器那套接口造一个可以手动喂事件的替身。 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: URL | string) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((existing) => existing !== listener),
    );
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const event =
      data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function stubEventSource() {
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.instances = [];
  return () => FakeEventSource.instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useJobStream", () => {
  it("按作业收快照：后到的旧版本丢掉，连接状态跟着事件走", async () => {
    const instances = stubEventSource();
    const { result } = renderHook(() => useJobStream("g"));

    await waitFor(() => expect(instances()).toHaveLength(1));
    const source = instances()[0];
    // 浏览器的 EventSource 不能带请求头：身份走查询串。
    expect(source?.url).toContain("/api/v1/games/g/jobs/stream");
    expect(source?.url).toContain("token=");

    act(() => source?.emit("open"));
    expect(result.current.connected).toBe(true);

    act(() => {
      source?.emit("job", { job: job("a", "running", "2026-01-02T03:04:06.000Z") });
      source?.emit("job", { job: job("a", "succeeded", "2026-01-02T03:04:09.000Z") });
    });
    expect(result.current.jobs.a?.status).toBe("succeeded");

    // 补发与实时可能交错：旧版本不许回退界面。
    act(() => {
      source?.emit("job", { job: job("a", "running", "2026-01-02T03:04:06.000Z") });
    });
    expect(result.current.jobs.a?.status).toBe("succeeded");

    // 另一条作业各收各的。
    act(() => {
      source?.emit("job", { job: job("b", "pending", "2026-01-02T03:04:10.000Z") });
    });
    expect(Object.keys(result.current.jobs).sort()).toEqual(["a", "b"]);

    act(() => source?.emit("error"));
    expect(result.current.connected).toBe(false);
  });

  it("关掉时不开连接，卸载时断开", async () => {
    const instances = stubEventSource();
    const disabled = renderHook(() => useJobStream("g", { enabled: false }));
    expect(instances()).toHaveLength(0);
    disabled.unmount();

    const { unmount } = renderHook(() => useJobStream("g"));
    await waitFor(() => expect(instances()).toHaveLength(1));
    unmount();
    expect(instances()[0]?.closed).toBe(true);
  });
});

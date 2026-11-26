import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameFixtures } from "../../mock/fixtures/game";
import TurnDialog from "./TurnDialog";

const view = gameFixtures.active;
const self = view.viewer.actorId;

function order(control: "agent" | "player") {
  return {
    id: "order-1",
    status: "active" as const,
    createdAt: "2026-01-02T03:04:05.000Z",
    completedAt: null,
    gameVersion: 0,
    entries: [
      {
        actorId: self,
        actorName: view.viewer.name,
        position: 1,
        turnsTaken: 0,
        control,
        alive: true,
      },
    ],
    nextActor: { position: 1, actorId: self, actorName: view.viewer.name, control },
  };
}

/** 按路径分发：顺位、作业读取、入队、接管。读作业回放给定序列。 */
function stubServer(options: {
  control: "agent" | "player";
  order: ReturnType<typeof order> | null;
  jobs?: Record<string, unknown>[];
}) {
  const jobs = options.jobs ?? [];
  let read = 0;
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      // openapi-fetch 带 body 时给的是 Request：正文要从它身上读，init 里没有。
      const rawBody = input instanceof Request ? await input.clone().text() : (init?.body ?? "");
      const body = rawBody === "" ? undefined : JSON.parse(String(rawBody));
      calls.push({ url, body });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });

      if (url.includes("/jobs?") || url.endsWith("/jobs")) {
        return json({ jobs: [] });
      }
      if (url.includes("/turns/pass")) {
        return json({ results: [{ actorName: view.viewer.name, counted: true }] });
      }
      if (url.includes("/stage-map")) {
        return json({ stages: { 鸦葬岗: [view.viewer.name, "收尸人卡尔"] } });
      }
      if (url.includes("/turns/")) {
        const first = jobs[0] ?? pendingJob();
        return json(
          { job: { ...first, kind: url.includes("stage") ? "turn.stage" : "turn.actor.npc" } },
          202,
        );
      }
      if (url.includes("/action-orders/current")) {
        return json({ order: options.order });
      }
      if (url.includes("/action-orders")) {
        return json({ order: order("player") });
      }
      if (url.includes("/control")) {
        return json({ result: { actorId: self } });
      }
      if (url.includes("/actions")) {
        const first = jobs[0] ?? pendingJob();
        return json({ job: first }, 202);
      }
      if (url.includes("/jobs/")) {
        const snapshot = jobs[Math.min(read, jobs.length - 1)] ?? pendingJob();
        read += 1;
        return json({ job: snapshot });
      }
      return json({ error: "not_found", message: `未预料的请求：${url}` }, 404);
    }),
  );
  return calls;
}

function pendingJob() {
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
  };
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TurnDialog slug={view.game.slug} view={view} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TurnDialog", () => {
  it("没有顺位时先让人开一条：不知道轮到谁就没有回合", async () => {
    stubServer({ control: "player", order: null });
    renderDialog();

    expect(await screen.findByRole("button", { name: "开一条顺位" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交这一回合" })).not.toBeInTheDocument();
  });

  it("agent 驱动的角色先给接管按钮", async () => {
    const calls = stubServer({ control: "agent", order: order("agent") });
    renderDialog();

    expect(await screen.findByRole("button", { name: "接管" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交这一回合" })).not.toBeInTheDocument();

    screen.getByRole("button", { name: "接管" }).click();
    await waitFor(() => expect(calls.some((call) => call.url.includes("/control"))).toBe(true));
  });

  it("玩家回合：目标用引用而不是真名，提交后到终态就关窗", async () => {
    const terminal = { ...pendingJob(), status: "succeeded" };
    const calls = stubServer({
      control: "player",
      order: order("player"),
      jobs: [{ ...pendingJob(), status: "running" }, terminal],
    });
    const onClose = renderDialog();

    const submit = await screen.findByRole("button", { name: "提交这一回合" });
    // 默认目标是空的：不选人就不该能提交。
    expect(submit).toBeDisabled();

    const target = view.stage.actors.find((actor) => !actor.self && actor.alive);
    expect(target).toBeDefined();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: target?.token ?? "" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "你好" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "提交这一回合" })).toBeEnabled());
    screen.getByRole("button", { name: "提交这一回合" }).click();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const submitted = calls.find((call) => call.url.includes("/actions"));
    // fixture 里舞台 token 就是编号，所以这里等于原样提交；「认得的名字 → 编号」
    // 这条换算是 `targetRefOf` 的职责，由它自己的用例守着。
    expect(submitted?.body).toMatchObject({
      action: { kind: "say", target: target?.token, message: "你好" },
    });
    // 引用用真名（与 CLI 同一个入口）；uuid 不是合法的 actor ref。
    expect(submitted?.url).toContain(`/actors/${encodeURIComponent(view.viewer.name)}/actions`);
  });
});

describe("TurnDialog：推进一步", () => {
  it("agent 回合由界面推：一个 actor + 它所在舞台，轮末补 world", async () => {
    const npc = {
      ...order("agent").entries[0],
      actorName: "戈特",
      control: "agent" as const,
    };
    const selfEntry = {
      ...order("player").entries[0],
      position: 2,
      turnsTaken: 0,
      control: "player" as const,
    };
    const before = {
      ...order("player"),
      entries: [npc, selfEntry],
      nextActor: {
        position: 1,
        actorId: npc.actorId,
        actorName: npc.actorName,
        control: "agent" as const,
      },
    };
    // 推进之后：活人计数齐平（1/1），下一次读就该补 world。
    const after = {
      ...before,
      entries: [
        { ...npc, turnsTaken: 1 },
        { ...selfEntry, turnsTaken: 1 },
      ],
      nextActor: null,
    };

    // 顺位在「推完那个 agent 回合」之后才算这一轮走完；不能按读取次数切，页面自己也在轮询。
    let npcDone = false;
    const calls: { url: string; body: unknown }[] = [];
    const terminal = { ...pendingJob(), status: "succeeded" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const rawBody = input instanceof Request ? await input.clone().text() : (init?.body ?? "");
        calls.push({ url, body: rawBody === "" ? undefined : JSON.parse(String(rawBody)) });
        const json = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (url.includes("/action-orders/current")) {
          return json({ order: npcDone ? after : before });
        }
        if (url.includes("/jobs?") || url.endsWith("/jobs")) {
          return json({ jobs: [] });
        }
        if (url.includes("/turns/pass")) {
          return json({ results: [{ actorName: view.viewer.name, counted: true }] });
        }
        if (url.includes("/stage-map")) {
          return json({ stages: { 鸦葬岗: ["戈特", view.viewer.name] } });
        }
        if (url.includes("/turns/")) {
          if (url.includes("/turns/npc")) {
            npcDone = true;
          }
          return json({ job: terminal }, 202);
        }
        if (url.includes("/jobs/")) {
          return json({ job: terminal });
        }
        return json({ error: "not_found", message: url }, 404);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TurnDialog slug={view.game.slug} view={view} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "推进一步" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.url.includes("/turns/"))).toHaveLength(3),
    );
    const turns = calls.filter((call) => call.url.includes("/turns/")).map((call) => call.body);
    expect(turns[0]).toMatchObject({ actor: "戈特", expectedVersion: 0 });
    expect(turns[1]).toMatchObject({ stage: "鸦葬岗" });
    // world 回合没有 body：它推的是整个世界的这一拍。
    expect(turns[2]).toEqual({});
    expect(await screen.findByText(/推了 npc \+ stage \+ world/)).toBeInTheDocument();
  });
});

describe("TurnDialog：空回合", () => {
  it("玩家席位待机时记一条空回合，计数照加", async () => {
    let passed = 0;
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const rawBody = input instanceof Request ? await input.clone().text() : (init?.body ?? "");
        calls.push({ url, body: rawBody === "" ? undefined : JSON.parse(String(rawBody)) });
        const json = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (url.includes("/jobs?") || url.endsWith("/jobs")) {
          return json({ jobs: [] });
        }
        if (url.includes("/turns/pass")) {
          passed += 1;
          return json({ results: [{ actorName: view.viewer.name, counted: true }] });
        }
        if (url.includes("/action-orders/current")) {
          return json({
            order: {
              ...order("player"),
              entries: [{ ...order("player").entries[0], turnsTaken: passed }],
            },
          });
        }
        return json({ error: "not_found", message: url }, 404);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TurnDialog slug={view.game.slug} view={view} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "这一趟我空过" }));
    await waitFor(() => expect(passed).toBe(1));

    const call = calls.find((entry) => entry.url.includes("/turns/pass"));
    // 用真名定位自己：这是调度命令，不用旁人称呼。
    expect(call?.body).toEqual({ actors: [view.viewer.name] });
    expect(await screen.findByText("记了一条空回合")).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntryPage from "./EntryPage";

const calls: { url: string; authorization: string | null }[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : undefined;
      const url = request === undefined ? String(input) : request.url;
      calls.push({ url, authorization: request?.headers.get("Authorization") ?? null });

      if (url.endsWith("/api/v1/me")) {
        return json({ user: { id: "u1", username: "demo", displayName: "演示用户" } });
      }
      if (url.endsWith("/api/v1/health")) {
        return json({
          status: "ok",
          service: "ai-trpg-server",
          version: "0.1.0",
          apiVersion: "v1",
          uptimeSeconds: 5,
          serverTime: new Date().toISOString(),
        });
      }
      if (url.endsWith("/api/v1/games/content-packs")) {
        return json({ packs: ["dark-fantasy:crow-grave"] });
      }
      if (url.endsWith("/api/v1/games")) {
        return json({
          state: { game: { slug: "crow-ui", name: "鸦葬岗的故事", status: "active", version: 0 } },
        });
      }
      return json({ error: "unexpected" });
    }),
  );
}

function SlugProbe() {
  const { slug } = useParams();
  return <p>已进入 {slug}</p>;
}

function renderEntry() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<EntryPage />} />
          <Route path="/g/:slug" element={<SlugProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("EntryPage", () => {
  it("显示身份与内容包，并把鉴权头带到每个请求", async () => {
    stubApi();
    renderEntry();

    expect(await screen.findByText("demo（演示用户）")).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: "dark-fantasy:crow-grave" }),
    ).toBeInTheDocument();
    expect(calls.every((call) => call.authorization === "Bearer demo")).toBe(true);
  });

  it("建局成功后跳到该局的占位页", async () => {
    stubApi();
    renderEntry();

    // 内容包就绪前按钮是禁用的，先等下拉可用。
    await screen.findByRole("option", { name: "dark-fantasy:crow-grave" });
    fireEvent.click(screen.getByRole("button", { name: "开始游戏" }));

    expect(await screen.findByText("已进入 crow-ui")).toBeInTheDocument();
  });
});

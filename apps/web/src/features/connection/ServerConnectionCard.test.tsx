import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServerConnectionCard from "./ServerConnectionCard";

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerConnectionCard />
    </QueryClientProvider>,
  );
}

function stubHealthResponse() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            service: "ai-trpg-server",
            version: "0.1.0",
            apiVersion: "v1",
            uptimeSeconds: 65,
            serverTime: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServerConnectionCard", () => {
  it("连接成功时展示服务信息", async () => {
    stubHealthResponse();
    renderCard();

    expect(await screen.findByText("已连接")).toBeInTheDocument();
    expect(screen.getByText("ai-trpg-server")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("1 分 5 秒")).toBeInTheDocument();
  });

  it("服务端不可达时展示错误态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderCard();

    expect(await screen.findByText("连接失败")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("无法连接服务端");
  });
});

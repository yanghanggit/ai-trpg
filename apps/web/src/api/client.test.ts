import { afterEach, describe, expect, it, vi } from "vitest";
import { api, playerUsername } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("每个请求都带开发期身份头", async () => {
    const fetchMock = vi.fn(
      async (_input: Request) =>
        new Response(
          JSON.stringify({ user: { id: "u1", username: "demo", displayName: "演示用户" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.GET("/api/v1/me");

    const request = fetchMock.mock.calls[0]?.[0] as Request | undefined;
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${playerUsername}`);
  });
});

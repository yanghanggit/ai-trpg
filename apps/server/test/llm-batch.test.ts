import { describe, expect, it } from "vitest";
import { batchComplete } from "../src/llm/batch";
import { ChatError } from "../src/llm/errors";
import type { ChatCompletionService } from "../src/llm/protocol";
import { ChatCompletionRequest, ChatCompletionResult } from "../src/llm/types";

function request(label: string): ChatCompletionRequest {
  return new ChatCompletionRequest({
    label,
    inputMessage: "ping",
    messages: [{ type: "system", content: "sys" }],
    dump: false,
  });
}

function result(requestValue: ChatCompletionRequest, content = "ok"): ChatCompletionResult {
  return new ChatCompletionResult({
    request: requestValue,
    aiMessage: { type: "ai", content },
    finishReason: "stop",
  });
}

class FakeService implements ChatCompletionService {
  constructor(private readonly failLabels: ReadonlySet<string> = new Set()) {}

  async complete(requestValue: ChatCompletionRequest): Promise<ChatCompletionResult> {
    if (this.failLabels.has(requestValue.label)) {
      return new ChatCompletionResult({
        request: requestValue,
        error: new ChatError(requestValue.label, "boom", { kind: "api", statusCode: 500 }),
      });
    }
    return result(requestValue);
  }
}

describe("batchComplete", () => {
  it("空请求返回空数组", async () => {
    expect(await batchComplete(new FakeService(), [])).toEqual([]);
  });

  it("结果与请求等长且同序，失败走 error", async () => {
    const requests = [request("c0"), request("c1"), request("c2")];
    const results = await batchComplete(new FakeService(new Set(["c1"])), requests, {
      maxConcurrency: 3,
    });

    expect(results.map((item) => item.label)).toEqual(["c0", "c1", "c2"]);
    expect(results.map((item) => item.ok)).toEqual([true, false, true]);
    expect(results[1]?.error?.statusCode).toBe(500);
  });

  it("意外异常被收敛成 result.error，不破坏等长返回", async () => {
    const service: ChatCompletionService = {
      async complete() {
        throw new Error("boom");
      },
    };
    const results = await batchComplete(service, [request("x")]);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error?.message).toContain("boom");
  });

  it("限制同时在飞的请求数", async () => {
    let current = 0;
    let max = 0;
    const service: ChatCompletionService = {
      async complete(requestValue) {
        current += 1;
        max = Math.max(max, current);
        await new Promise((resolve) => setTimeout(resolve, 10));
        current -= 1;
        return result(requestValue);
      },
    };

    const results = await batchComplete(
      service,
      Array.from({ length: 5 }, (_, index) => request(`c${index}`)),
      { maxConcurrency: 2 },
    );

    expect(results.every((item) => item.ok)).toBe(true);
    expect(max).toBeLessThanOrEqual(2);
    expect(current).toBe(0);
  });

  it("拒绝非法并发数", async () => {
    await expect(
      batchComplete(new FakeService(), [request("x")], { maxConcurrency: 0 }),
    ).rejects.toThrow(RangeError);
  });
});

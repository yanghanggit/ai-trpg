import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_MODEL_FLASH,
  DEEPSEEK_MODEL_PRO,
  DEEPSEEK_SERVICE,
  DeepSeekClient,
  type DeepSeekClientOptions,
} from "../src/deepseek/client";
import { ChatError, DeepSeekError } from "../src/deepseek/errors";
import {
  ChatCompletionRequest,
  type ChatCompletionRequestInit,
  type ToolCall,
  type ToolDefinition,
} from "../src/llm/types";

type FetchCall = { url: string; init: RequestInit | undefined };
type Handler = (url: string, init: RequestInit | undefined) => Promise<Response>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  handler: Handler,
  options: Partial<DeepSeekClientOptions> = {},
): { calls: FetchCall[]; client: DeepSeekClient } {
  const calls: FetchCall[] = [];
  const client = new DeepSeekClient({
    apiKey: "test-key",
    ...options,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  });
  return { calls, client };
}

function makeRequest(overrides: Partial<ChatCompletionRequestInit> = {}): ChatCompletionRequest {
  return new ChatCompletionRequest({
    label: "test",
    inputMessage: "ping",
    messages: [{ type: "system", content: "sys" }],
    ...overrides,
  });
}

function successPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "hi", reasoning_content: "think" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 5,
      completion_tokens_details: { reasoning_tokens: 6 },
    },
    ...overrides,
  };
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  const raw = call?.init?.body;
  if (typeof raw !== "string") {
    throw new TypeError("请求 body 不是字符串");
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

const weatherTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "获取天气",
    parameters: { type: "object", properties: { city: { type: "string" } } },
  },
};

const weatherCall: ToolCall = {
  id: "call-1",
  type: "function",
  function: { name: "get_weather", arguments: '{"city":"北京"}' },
};

describe("DeepSeekClient", () => {
  it("成功响应解析 content / reasoning / usage / toolCalls", async () => {
    const payload = successPayload({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "hi",
            reasoning_content: "think",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"北京"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const { calls, client } = makeClient(async () => jsonResponse(payload));

    const result = await client.complete(makeRequest());

    expect(result.ok).toBe(true);
    expect(result.content).toBe("hi");
    expect(result.reasoningContent).toBe("think");
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([weatherCall]);
    expect(result.usage).toEqual({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 5,
      reasoningTokens: 6,
    });
    expect(result.aiMessage?.metadata?.contextUsageRatio).toBe(3 / 1_000_000);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const call = calls[0];
    expect(call?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(call?.init?.method).toBe("POST");
    const headers = call?.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-key");
    const body = bodyOf(call);
    expect(body.model).toBe(DEEPSEEK_MODEL_FLASH);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "ping" },
    ]);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tool_choice).toBe("none");
    expect(body.tools).toBeUndefined();
  });

  it("把 tools / thinking / reasoningEffort / 模型参数翻译成 wire 格式", async () => {
    const { calls, client } = makeClient(async () => jsonResponse(successPayload()));
    const request = makeRequest({
      inputMessage: "",
      messages: [
        { type: "system", content: "sys" },
        { type: "ai", content: "", toolCalls: [weatherCall] },
        { type: "tool", content: "25°C", toolCallId: "call-1" },
      ],
      tools: [weatherTool],
      toolChoice: "auto",
      thinking: true,
      reasoningEffort: "high",
      model: DEEPSEEK_MODEL_PRO,
      temperature: 0.5,
      maxTokens: 100,
    });

    const result = await client.complete(request);
    expect(result.ok).toBe(true);

    const body = bodyOf(calls[0]);
    expect(body.model).toBe(DEEPSEEK_MODEL_PRO);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([weatherTool]);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"北京"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "25°C" },
    ]);
  });

  it("没有显式 toolChoice 时，有 tools 则默认 required", async () => {
    const { calls, client } = makeClient(async () => jsonResponse(successPayload()));
    await client.complete(makeRequest({ tools: [weatherTool] }));
    expect(bodyOf(calls[0]).tool_choice).toBe("required");
  });

  it("超时映射为 kind=timeout", async () => {
    const { client } = makeClient(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    const result = await client.complete(makeRequest());
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("timeout");
    expect(result.error?.retryable).toBe(true);
    expect(result.error?.statusCode).toBeUndefined();
  });

  it("取消把原因原样抛出，不记成通讯失败", async () => {
    const controller = new AbortController();
    const reason = new Error("作业在执行中被取消");
    controller.abort(reason);
    // 真实 fetch 在 signal 被掐时会以 signal.reason 拒绝；这里照着这个行为造一个。
    const { client } = makeClient(async (_url, init) => {
      throw (init?.signal as AbortSignal | undefined)?.reason ?? new Error("请求没挂信号");
    });

    await expect(client.complete(makeRequest({ signal: controller.signal }))).rejects.toBe(reason);
  });

  it("取消能传到线上：掐外部信号，请求自己也断", async () => {
    const controller = new AbortController();
    let onTheWire: AbortSignal | undefined;
    const { client } = makeClient(async (_url, init) => {
      onTheWire = init?.signal as AbortSignal | undefined;
      return jsonResponse(successPayload());
    });
    await client.complete(makeRequest({ signal: controller.signal }));

    // 只有取并集，外部 abort 才能让这一发请求断掉。
    expect(onTheWire).toBeInstanceOf(AbortSignal);
    expect(onTheWire?.aborted).toBe(false);
    controller.abort();
    expect(onTheWire?.aborted).toBe(true);
  });

  it("外部信号没触发时，超时仍按 timeout 分类", async () => {
    const controller = new AbortController();
    const { client } = makeClient(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    const result = await client.complete(makeRequest({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("timeout");
  });

  it("网络错误映射为 kind=connection", async () => {
    const { client } = makeClient(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await client.complete(makeRequest());
    expect(result.error?.kind).toBe("connection");
    expect(result.error?.retryable).toBe(true);
  });

  it("非 200 响应保留状态码与响应正文", async () => {
    const { client } = makeClient(async () => new Response("bad key", { status: 401 }));
    const result = await client.complete(makeRequest());
    expect(result.error?.kind).toBe("api");
    expect(result.error?.statusCode).toBe(401);
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.details).toBe("bad key");
  });

  it("429 判定为可重试", async () => {
    const { client } = makeClient(async () => new Response("rate limited", { status: 429 }));
    const result = await client.complete(makeRequest());
    expect(result.error?.statusCode).toBe(429);
    expect(result.error?.retryable).toBe(true);
  });

  it("非法 JSON 响应收敛为 error", async () => {
    const { client } = makeClient(async () => new Response("not json", { status: 200 }));
    const result = await client.complete(makeRequest());
    expect(result.error?.kind).toBe("api");
    expect(result.error?.message).toContain("合法 JSON");
  });

  it("空 choices 收敛为 error", async () => {
    const { client } = makeClient(async () => jsonResponse({ choices: [] }));
    const result = await client.complete(makeRequest());
    expect(result.error?.kind).toBe("api");
    expect(result.error?.message).toContain("choices");
  });

  it("缺失 usage 时仍成功，usage 为 undefined", async () => {
    const payload = successPayload();
    delete payload.usage;
    const { client } = makeClient(async () => jsonResponse(payload));
    const result = await client.complete(makeRequest());
    expect(result.ok).toBe(true);
    expect(result.usage).toBeUndefined();
    expect(result.aiMessage?.metadata).toBeUndefined();
  });

  it("畸形 tool_calls 收敛为 error", async () => {
    const payload = successPayload({
      choices: [
        {
          message: { role: "assistant", content: "", tool_calls: [{ id: "call-1" }] },
          finish_reason: "tool_calls",
        },
      ],
    });
    const { client } = makeClient(async () => jsonResponse(payload));
    const result = await client.complete(makeRequest());
    expect(result.error?.kind).toBe("api");
    expect(result.error?.message).toContain("解析失败");
  });

  it("listModels / getBalance 使用 GET 并解析", async () => {
    const { calls, client } = makeClient(async (url) => {
      if (url.endsWith("/models")) {
        return jsonResponse({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] });
      }
      return jsonResponse({ is_available: true });
    });

    await expect(client.listModels()).resolves.toEqual([DEEPSEEK_MODEL_FLASH, DEEPSEEK_MODEL_PRO]);
    await expect(client.getBalance()).resolves.toEqual({ is_available: true });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.deepseek.com/models",
      "https://api.deepseek.com/user/balance",
    ]);
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("缺少 API key 时抛出配置错误", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const client = new DeepSeekClient({ fetch: async () => jsonResponse(successPayload()) });
      await expect(client.complete(makeRequest())).rejects.toThrow("DEEPSEEK_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("DeepSeekError 是 ChatError 的别名，默认实例可复用", () => {
    expect(DeepSeekError).toBe(ChatError);
    expect(DEEPSEEK_SERVICE).toBeInstanceOf(DeepSeekClient);
  });
});

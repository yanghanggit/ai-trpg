import { describe, expect, it } from "vitest";
import { ChatError, type ErrorKind } from "../src/llm/errors";
import { getBufferString } from "../src/llm/messages";
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  type ChatMessage,
  type ToolDefinition,
} from "../src/llm/types";

function makeRequest(
  overrides: Partial<ConstructorParameters<typeof ChatCompletionRequest>[0]> = {},
) {
  return new ChatCompletionRequest({
    label: "t",
    inputMessage: "ping",
    messages: [{ type: "system", content: "sys" }],
    ...overrides,
  });
}

describe("ChatError", () => {
  it.each<[ErrorKind, number | undefined, boolean]>([
    ["timeout", undefined, true],
    ["connection", undefined, true],
    ["api", 429, true],
    ["api", 408, true],
    ["api", 500, true],
    ["api", 503, true],
    ["api", 400, false],
    ["api", 401, false],
    ["api", 402, false],
    ["api", 422, false],
    ["api", undefined, false],
  ])("kind=%s status=%s -> retryable=%s", (kind, statusCode, expected) => {
    const error = new ChatError("无名", "boom", { kind, statusCode });
    expect(error.retryable).toBe(expected);
    expect(error.label).toBe("无名");
    expect(error.statusCode).toBe(statusCode);
    expect(error.message).toContain("[无名]");
    expect(error).toBeInstanceOf(Error);
  });

  it("保留 details 与 cause", () => {
    const cause = new Error("root");
    const error = new ChatError("t", "boom", {
      kind: "api",
      statusCode: 500,
      details: { body: "x" },
      cause,
    });
    expect(error.details).toEqual({ body: "x" });
    expect(error.cause).toBe(cause);
  });
});

describe("ChatCompletionRequest", () => {
  it("默认值正确且对象被冻结", () => {
    const request = makeRequest();
    expect(request.model).toBeUndefined();
    expect(request.thinking).toBe(false);
    expect(request.tools).toEqual([]);
    expect(request.toolChoice).toBeUndefined();
    expect(Object.isFrozen(request)).toBe(true);
  });

  it.each([
    [{ label: "" }],
    [{ inputMessage: "" }],
    [{ timeoutMs: 0 }],
    [{ timeoutMs: Number.NaN }],
    [{ maxTokens: 0 }],
    [{ maxTokens: 1.5 }],
    [{ temperature: -1 }],
  ])("拒绝非法参数 %o", (overrides) => {
    expect(() => makeRequest(overrides)).toThrow();
  });

  it("有 tools 时允许空 inputMessage（continuation 模式）", () => {
    const tool: ToolDefinition = {
      type: "function",
      function: { name: "ping", description: "ping", parameters: { type: "object" } },
    };
    const request = makeRequest({ inputMessage: "", tools: [tool] });
    expect(request.inputMessage).toBe("");
    expect(request.tools).toHaveLength(1);
  });
});

describe("ChatCompletionResult", () => {
  it("成功时暴露 label / content / reasoningContent", () => {
    const request = makeRequest();
    const result = new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "hi", reasoningContent: "think" },
      finishReason: "stop",
    });
    expect(result.ok).toBe(true);
    expect(result.label).toBe("t");
    expect(result.content).toBe("hi");
    expect(result.reasoningContent).toBe("think");
  });

  it("失败时 content / reasoningContent 为空串", () => {
    const request = makeRequest();
    const result = new ChatCompletionResult({
      request,
      error: new ChatError("t", "boom", { kind: "timeout" }),
    });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.reasoningContent).toBe("");
  });
});

describe("getBufferString", () => {
  it("按角色渲染文本", () => {
    const messages: ChatMessage[] = [
      { type: "system", content: "sys" },
      { type: "human", content: "hi" },
      { type: "ai", content: "hello" },
      { type: "tool", content: "result", toolCallId: "call-1" },
    ];
    expect(getBufferString(messages)).toBe("System: sys\nHuman: hi\nAI: hello\nTool: result");
  });

  it("可选渲染 tool_calls", () => {
    const messages: ChatMessage[] = [
      {
        type: "ai",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: '{"city":"北京"}' },
          },
        ],
      },
    ];
    expect(getBufferString(messages, { renderToolCalls: true })).toContain("weather");
    expect(getBufferString(messages)).toBe("AI: ");
  });
});

import { describe, expect, it } from "vitest";
import { agentLoop, LOOP_END_ATTR, LOOP_ID_ATTR } from "../src/llm/agent-loop";
import { ChatError } from "../src/llm/errors";
import type { ChatCompletionService } from "../src/llm/protocol";
import {
  type ChatCompletionRequest,
  ChatCompletionResult,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
} from "../src/llm/types";

const weatherTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "获取指定城市的天气",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const submitTool: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_result",
    description: "提交最终结果",
    parameters: {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
    },
  },
};

function toolCall(name: string, args: Record<string, unknown>, id = "call-1"): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completion(
  request: ChatCompletionRequest,
  init: { content?: string; finishReason?: string; toolCalls?: ToolCall[] } = {},
): ChatCompletionResult {
  return new ChatCompletionResult({
    request,
    aiMessage: {
      type: "ai",
      content: init.content ?? "",
      ...(init.toolCalls && init.toolCalls.length > 0 ? { toolCalls: init.toolCalls } : {}),
    },
    finishReason: init.finishReason ?? "stop",
    toolCalls: init.toolCalls ?? [],
  });
}

function scriptedService(
  responder: (request: ChatCompletionRequest, callIndex: number) => ChatCompletionResult,
): { calls: ChatCompletionRequest[]; service: ChatCompletionService } {
  const calls: ChatCompletionRequest[] = [];
  return {
    calls,
    service: {
      async complete(request) {
        calls.push(request);
        return responder(request, calls.length - 1);
      },
    },
  };
}

function systemMessage(): ChatMessage {
  return { type: "system", content: "sys" };
}

describe("agentLoop", () => {
  it("执行工具、回填 ToolMessage，并记录 loop 边界", async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    const { calls, service } = scriptedService((request, index) =>
      index === 0
        ? completion(request, {
            finishReason: "tool_calls",
            toolCalls: [toolCall("get_weather", { city: "北京" })],
          })
        : completion(request, { content: "北京晴，25°C" }),
    );
    const messages: ChatMessage[] = [systemMessage()];

    const result = await agentLoop({
      name: "weather",
      inputMessage: "北京天气怎么样？",
      messages,
      tools: [weatherTool],
      handlers: {
        get_weather: (args) => {
          receivedArgs = args;
          return "25°C 晴";
        },
      },
      service,
      loopId: "loop-1",
    });

    expect(result.ok).toBe(true);
    expect(receivedArgs).toEqual({ city: "北京" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.inputMessage).toBe("");
    expect(calls[1]?.messages.some((message) => message.type === "tool")).toBe(true);
    expect(messages.map((message) => message.type)).toEqual([
      "system",
      "human",
      "ai",
      "tool",
      "ai",
    ]);
    expect(messages[3]).toMatchObject({
      type: "tool",
      content: "25°C 晴",
      toolCallId: "call-1",
    });
    expect(result.startMessage?.metadata?.[LOOP_ID_ATTR]).toBe("loop-1");
    expect(messages.at(-1)?.metadata?.[LOOP_END_ATTR]).toBe("loop-1");
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.appended.map((message) => message.type)).toEqual([
      "human",
      "ai",
      "tool",
    ]);
  });

  it("声明 terminalTools 时，普通 stop 会注入纠偏提示并强制重试", async () => {
    const { calls, service } = scriptedService((request, index) =>
      index === 0
        ? completion(request, { content: "我直接回答" })
        : completion(request, {
            finishReason: "tool_calls",
            toolCalls: [toolCall("submit_result", { result: "ok" })],
          }),
    );

    const result = await agentLoop({
      name: "terminal",
      inputMessage: "提交结果",
      messages: [systemMessage()],
      tools: [submitTool],
      terminalTools: [submitTool],
      handlers: { submit_result: () => "submitted" },
      service,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.toolChoice).toBe("required");
    const nudged = calls[1]?.messages.some(
      (message) => message.type === "human" && message.content.includes("终止工具"),
    );
    expect(nudged).toBe(true);
  });

  it("未调用终止工具且超过 nudge 上限时失败", async () => {
    const { calls, service } = scriptedService((request) =>
      completion(request, { content: "still no tool" }),
    );

    const result = await agentLoop({
      name: "terminal-fail",
      inputMessage: "提交结果",
      messages: [systemMessage()],
      tools: [submitTool],
      terminalTools: [submitTool],
      handlers: { submit_result: () => "submitted" },
      service,
      maxTerminalNudges: 0,
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("达到最大轮次时返回失败", async () => {
    const { calls, service } = scriptedService((request) =>
      completion(request, {
        finishReason: "tool_calls",
        toolCalls: [toolCall("get_weather", { city: "北京" })],
      }),
    );

    const result = await agentLoop({
      name: "max-rounds",
      inputMessage: "查天气",
      messages: [systemMessage()],
      tools: [weatherTool],
      handlers: { get_weather: () => "25°C" },
      service,
      maxRounds: 2,
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(2);
    expect(result.rounds).toHaveLength(2);
  });

  it("未知工具与 handler 异常都会写回 ToolMessage，循环可继续", async () => {
    const { service } = scriptedService((request, index) => {
      if (index === 0) {
        return completion(request, {
          finishReason: "tool_calls",
          toolCalls: [
            toolCall("unknown_tool", {}),
            toolCall("get_weather", { city: "北京" }, "call-2"),
          ],
        });
      }
      return completion(request, { content: "done" });
    });
    const messages: ChatMessage[] = [systemMessage()];

    const result = await agentLoop({
      name: "tool-errors",
      inputMessage: "试试工具",
      messages,
      tools: [weatherTool],
      handlers: {
        get_weather: () => {
          throw new Error("weather service down");
        },
      },
      service,
    });

    expect(result.ok).toBe(true);
    const toolMessages = messages.filter((message) => message.type === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.content).toContain("未知工具");
    expect(toolMessages[1]?.content).toContain("工具执行失败");
  });

  it("mutateMessages=false 时在浅拷贝上工作", async () => {
    const original: ChatMessage[] = [systemMessage()];
    const { service } = scriptedService((request) => completion(request, { content: "hi" }));

    const result = await agentLoop({
      name: "copy",
      inputMessage: "hello",
      messages: original,
      tools: [],
      handlers: {},
      service,
      mutateMessages: false,
    });

    expect(result.ok).toBe(true);
    expect(original).toHaveLength(1);
    expect(result.messages).toHaveLength(3);
    expect(result.messages).not.toBe(original);
  });

  it("单轮通讯失败后继续下一轮", async () => {
    const { calls, service } = scriptedService((request, index) =>
      index === 0
        ? new ChatCompletionResult({
            request,
            error: new ChatError(request.label, "boom", { kind: "timeout" }),
          })
        : completion(request, { content: "recovered" }),
    );

    const result = await agentLoop({
      name: "retry",
      inputMessage: "ping",
      messages: [systemMessage()],
      tools: [],
      handlers: {},
      service,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(result.rounds).toHaveLength(2);
    expect(result.messages.at(-1)?.content).toBe("recovered");
  });

  it("errorRetries 就地重发可重试失败，不占工具轮次", async () => {
    const { calls, service } = scriptedService((request, index) =>
      index < 2
        ? new ChatCompletionResult({
            request,
            error: new ChatError(request.label, "timeout", { kind: "timeout" }),
          })
        : completion(request, { content: "recovered" }),
    );
    const messages: ChatMessage[] = [systemMessage()];

    const result = await agentLoop({
      name: "in-place-retry",
      inputMessage: "ping",
      messages,
      tools: [],
      handlers: {},
      service,
      errorRetries: 2,
      errorRetryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(result.rounds).toHaveLength(1);
    expect(messages.map((message) => message.type)).toEqual(["system", "human", "ai"]);
  });

  it("不可重试的通讯失败不使用 errorRetries", async () => {
    const { calls, service } = scriptedService(
      (request) =>
        new ChatCompletionResult({
          request,
          error: new ChatError(request.label, "unauthorized", { kind: "api", statusCode: 401 }),
        }),
    );

    const result = await agentLoop({
      name: "non-retryable",
      inputMessage: "ping",
      messages: [systemMessage()],
      tools: [],
      handlers: {},
      service,
      maxRounds: 1,
      errorRetries: 2,
      errorRetryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("重试次数用尽后回到按轮推进", async () => {
    const { calls, service } = scriptedService(
      (request) =>
        new ChatCompletionResult({
          request,
          error: new ChatError(request.label, "timeout", { kind: "timeout" }),
        }),
    );

    const result = await agentLoop({
      name: "retry-exhausted",
      inputMessage: "ping",
      messages: [systemMessage()],
      tools: [],
      handlers: {},
      service,
      maxRounds: 1,
      errorRetries: 1,
      errorRetryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    // 1 次首发 + 1 次就地重试；用尽后不再额外重试。
    expect(calls).toHaveLength(2);
    expect(result.rounds).toHaveLength(1);
  });

  it("timeoutMs 透传给每次请求", async () => {
    const { calls, service } = scriptedService((request) => completion(request, { content: "ok" }));

    await agentLoop({
      name: "timeout",
      inputMessage: "ping",
      messages: [systemMessage()],
      tools: [],
      handlers: {},
      service,
      timeoutMs: 1_234,
    });

    expect(calls[0]?.timeoutMs).toBe(1_234);
  });
});

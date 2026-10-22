import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatError } from "../src/llm/errors";
import {
  ENV_LLM_DUMP_SWITCH,
  envAllowsDump,
  LLM_DUMP_DIR,
  saveTranscript,
  type TranscriptRecord,
} from "../src/llm/transcript";
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  type ToolCall,
  type Usage,
} from "../src/llm/types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-trpg-transcript-"));
  tempDirs.push(dir);
  return dir;
}

function makeRequest(dump = true, label = "测试.落盘"): ChatCompletionRequest {
  return new ChatCompletionRequest({
    label,
    inputMessage: "ping",
    messages: [{ type: "system", content: "sys" }],
    dump,
  });
}

function makeResult(request: ChatCompletionRequest): ChatCompletionResult {
  return new ChatCompletionResult({
    request,
    aiMessage: { type: "ai", content: "hi" },
    finishReason: "stop",
  });
}

async function readJsonl(dir: string): Promise<TranscriptRecord[]> {
  const files = await readdir(dir);
  const file = files.find((name) => name.endsWith(".jsonl"));
  expect(file).toBeDefined();
  const content = await readFile(join(dir, file ?? ""), "utf8");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TranscriptRecord);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("transcript 目录", () => {
  it("使用可发现的 logs/llm", () => {
    expect(LLM_DUMP_DIR).toBe("logs/llm");
  });
});

describe("envAllowsDump", () => {
  it.each<[string | undefined, boolean]>([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["off", false],
    ["true", true],
    ["1", true],
    ["YES", true],
  ])("raw=%o -> %s", (raw, expected) => {
    const env = raw === undefined ? {} : { [ENV_LLM_DUMP_SWITCH]: raw };
    expect(envAllowsDump(env)).toBe(expected);
  });
});

describe("saveTranscript", () => {
  it("text 格式包含消息、tool_calls 与 reasoning", async () => {
    const dir = await makeTempDir();
    const request = makeRequest();
    const result = new ChatCompletionResult({
      request,
      aiMessage: {
        type: "ai",
        content: "hi",
        reasoningContent: "think",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: '{"city":"北京"}' },
          },
        ],
      },
      finishReason: "tool_calls",
    });

    await saveTranscript(request, result, { dir, enabled: true, format: "text" });

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.txt$/);
    const text = await readFile(join(dir, files[0] ?? ""), "utf8");
    expect(text).toContain("System: sys");
    expect(text).toContain("Human: ping");
    expect(text).toContain("AI: hi");
    expect(text).toContain("[tool_calls]");
    expect(text).toContain("weather");
    expect(text).toContain("think");
  });

  it("jsonl 格式一行一轮，包含完整请求与响应", async () => {
    const dir = await makeTempDir();
    const toolCall: ToolCall = {
      id: "call-1",
      type: "function",
      function: { name: "weather", arguments: '{"city":"北京"}' },
    };
    const usage: Usage = {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 5,
      reasoningTokens: 6,
    };
    const request = new ChatCompletionRequest({
      label: "round-1",
      inputMessage: "ping",
      messages: [{ type: "system", content: "sys" }],
      temperature: 0.2,
      maxTokens: 100,
      dump: true,
    });
    const result = new ChatCompletionResult({
      request,
      aiMessage: {
        type: "ai",
        content: "hi",
        reasoningContent: "think",
        toolCalls: [toolCall],
        metadata: { contextUsageRatio: 0.5 },
      },
      finishReason: "tool_calls",
      toolCalls: [toolCall],
      usage,
      elapsedMs: 12,
    });

    await saveTranscript(request, result, { dir, enabled: true, format: "jsonl" });

    const records = await readJsonl(dir);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.version).toBe(1);
    expect(record?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record?.label).toBe("round-1");
    expect(record?.request).toMatchObject({
      label: "round-1",
      inputMessage: "ping",
      thinking: false,
      temperature: 0.2,
      maxTokens: 100,
      messages: [{ type: "system", content: "sys" }],
    });
    expect(record?.response).toEqual({
      finishReason: "tool_calls",
      content: "hi",
      reasoningContent: "think",
      toolCalls: [toolCall],
      usage,
      elapsedMs: 12,
      contextUsageRatio: 0.5,
    });
  });

  it("默认同时写 text 与同一个 JSONL 文件", async () => {
    const dir = await makeTempDir();
    const request = makeRequest();
    await saveTranscript(request, makeResult(request), { dir, enabled: true });
    const files = await readdir(dir);
    expect(files.filter((name) => name.endsWith(".txt"))).toHaveLength(1);
    expect(files.filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
  });

  it("多轮请求追加到同一个 JSONL 文件，行数与顺序正确", async () => {
    const dir = await makeTempDir();
    const requests = [0, 1, 2].map((index) => makeRequest(true, `round-${index}`));
    await Promise.all(
      requests.map((request) =>
        saveTranscript(request, makeResult(request), { dir, enabled: true, format: "jsonl" }),
      ),
    );

    const records = await readJsonl(dir);
    expect(records.map((record) => record.label).sort()).toEqual(["round-0", "round-1", "round-2"]);
  });

  it("request.dump=false 时不写文件", async () => {
    const dir = await makeTempDir();
    await saveTranscript(makeRequest(false), makeResult(makeRequest(false)), {
      dir,
      enabled: true,
    });
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("进程级关闭时不写文件", async () => {
    const dir = await makeTempDir();
    const request = makeRequest();
    await saveTranscript(request, makeResult(request), { dir, enabled: false });
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("失败结果不写文件", async () => {
    const dir = await makeTempDir();
    const request = makeRequest();
    const result = new ChatCompletionResult({
      request,
      error: new ChatError("测试.落盘", "boom", { kind: "timeout" }),
    });
    await saveTranscript(request, result, { dir, enabled: true });
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("环境变量可以开启 transcript", async () => {
    const dir = await makeTempDir();
    const previous = process.env[ENV_LLM_DUMP_SWITCH];
    try {
      process.env[ENV_LLM_DUMP_SWITCH] = "true";
      const request = makeRequest();
      await saveTranscript(request, makeResult(request), { dir });
      const files = await readdir(dir);
      expect(files.filter((name) => name.endsWith(".txt"))).toHaveLength(1);
      expect(files.filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
    } finally {
      if (previous === undefined) {
        delete process.env[ENV_LLM_DUMP_SWITCH];
      } else {
        process.env[ENV_LLM_DUMP_SWITCH] = previous;
      }
    }
  });

  it("text 文件名中的危险字符会被替换", async () => {
    const dir = await makeTempDir();
    const request = new ChatCompletionRequest({
      label: "a/b:c |d",
      inputMessage: "ping",
      messages: [{ type: "system", content: "sys" }],
      dump: true,
    });
    await saveTranscript(request, makeResult(request), { dir, enabled: true, format: "text" });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
    expect(files[0]).not.toContain(":");
    expect(files[0]).not.toContain("|");
  });
});

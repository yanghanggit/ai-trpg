/**
 * DeepSeek 冒烟测试（会真实调用 API，可能产生费用）。
 *
 * 用法：
 *   pnpm smoke:deepseek            # 基础用例
 *   pnpm smoke:deepseek:full       # 额外跑多工具调用与模型矩阵
 *
 * 只读取仓库根目录 `.env`；请求与响应由过程轨迹负责，脚本本身不落盘。
 */

import assert from "node:assert/strict";
import { config as loadEnvFile } from "dotenv";
import {
  agentLoop,
  batchComplete,
  DEEPSEEK_MODEL_FLASH,
  DEEPSEEK_MODEL_PRO,
  DeepSeekClient,
} from "../src/deepseek";
import { ROOT_ENV_FILE } from "../src/env";
import {
  ChatCompletionRequest,
  type ChatMessage,
  getBufferString,
  type ToolDefinition,
} from "../src/llm";
import { consoleLogger } from "../src/logging";

loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });

const FULL = process.argv.includes("--full");
const SYSTEM: ChatMessage = {
  type: "system",
  content: "你是一个有帮助的助手，请用中文回答。",
};

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function printResult(result: {
  content: string;
  reasoningContent: string;
  finishReason: string;
}): void {
  console.log(`finish_reason: ${result.finishReason}`);
  console.log(`回复: ${result.content}`);
  if (result.reasoningContent.length > 0) {
    console.log(`思考: ${result.reasoningContent.slice(0, 120).replace(/\n/g, " ")}...`);
  }
}

const WEATHER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_weather",
    description: "获取指定城市的当前天气信息",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称，例如 '北京'、'上海'" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "温度单位" },
      },
      required: ["city"],
    },
  },
};

const WEATHER_DATA: Readonly<Record<string, readonly [string, string]>> = {
  北京: ["25°C", "晴天"],
  上海: ["28°C", "多云"],
  广州: ["32°C", "雷阵雨"],
};

function getCurrentWeather(args: Record<string, unknown>): string {
  const city = typeof args.city === "string" ? args.city : "";
  const unit = typeof args.unit === "string" ? args.unit : "celsius";
  const data = WEATHER_DATA[city] ?? ["20°C", "未知"];
  const [temperature, condition] = data;
  const value = unit === "fahrenheit" ? temperature.replace("°C", "°F") : temperature;
  return `${city}当前天气：${value}，${condition}`;
}

function request(
  label: string,
  inputMessage: string,
  extra: Partial<ConstructorParameters<typeof ChatCompletionRequest>[0]> = {},
): ChatCompletionRequest {
  return new ChatCompletionRequest({
    label,
    inputMessage,
    messages: [SYSTEM],
    ...extra,
  });
}

function testGetBufferString(): void {
  section("getBufferString()");
  const text = getBufferString([
    SYSTEM,
    { type: "human", content: "你好，请介绍一下自己。" },
    { type: "ai", content: "你好！我是一个 AI 助手。" },
  ]);
  console.log(text);
}

async function testListModels(client: DeepSeekClient): Promise<void> {
  section("listModels()");
  const models = await client.listModels();
  assert.ok(models.length > 0, "未获取到模型列表");
  console.log(`可用模型（共 ${models.length} 个）：`);
  for (const model of models) {
    console.log(`  - ${model}`);
  }
}

async function testGetBalance(client: DeepSeekClient): Promise<void> {
  section("getBalance()");
  const balance = await client.getBalance();
  assert.ok(balance.is_available === true, "账户不可用或未获取到余额");
  console.log(`账户可用: ${String(balance.is_available)}`);
  const infos = Array.isArray(balance.balance_infos) ? balance.balance_infos : [];
  for (const raw of infos) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const info = raw as Record<string, unknown>;
    console.log(`  货币: ${String(info.currency ?? "")}`);
    console.log(`  总余额: ${String(info.total_balance ?? "")}`);
    console.log(`  赠送余额: ${String(info.granted_balance ?? "")}`);
    console.log(`  充值余额: ${String(info.topped_up_balance ?? "")}`);
  }
}

async function testChat(client: DeepSeekClient): Promise<void> {
  section("单次 complete()");
  const result = await client.complete(request("test_chat", "请简单介绍一下你自己。"));
  assert.ok(result.ok, result.error?.message);
  printResult(result);
}

async function testUsage(client: DeepSeekClient): Promise<void> {
  section("usage / context_usage_ratio");
  const result = await client.complete(request("test_cache", "请用一句话解释什么是缓存。"));
  assert.ok(result.ok, result.error?.message);
  assert.ok(result.usage, "预期 usage 不为空");
  console.log(`回复: ${result.content}`);
  console.log(`prompt_tokens      : ${result.usage.promptTokens}`);
  console.log(`completion_tokens  : ${result.usage.completionTokens}`);
  console.log(`total_tokens       : ${result.usage.totalTokens}`);
  console.log(`缓存命中 tokens     : ${result.usage.promptCacheHitTokens}`);
  console.log(`缓存未命中 tokens   : ${result.usage.promptCacheMissTokens}`);
  console.log(
    `上下文占比          : ${(result.usage.totalTokens / client.contextWindow()).toFixed(6)}`,
  );
}

async function testBatch(client: DeepSeekClient): Promise<void> {
  section("batchComplete()");
  const questions = ["1+1等于几？", "天空为什么是蓝色的？", "请用一句话描述 TypeScript。"];
  const requests = questions.map((question, index) => request(`batch_${index}`, question));
  const results = await batchComplete(requests, { service: client, maxConcurrency: 2 });

  assert.equal(results.length, requests.length);
  for (const result of results) {
    assert.ok(result.ok, result.error?.message);
    console.log(`\n❓ ${result.request.inputMessage}`);
    console.log(`💬 ${result.content}`);
  }
}

async function testToolCallSingle(client: DeepSeekClient): Promise<void> {
  section("tool calling 第一转");
  const result = await client.complete(
    request("test_tool_single", "北京现在天气怎么样？", { tools: [WEATHER_TOOL] }),
  );
  assert.ok(result.ok, result.error?.message);
  assert.equal(result.finishReason, "tool_calls");
  assert.ok(result.toolCalls.length > 0, "预期至少一个 tool call");
  for (const toolCall of result.toolCalls) {
    console.log(`工具: ${toolCall.function.name}`);
    console.log(`参数: ${toolCall.function.arguments}`);
    console.log(`ID  : ${toolCall.id}`);
  }
}

async function testToolFullRound(client: DeepSeekClient): Promise<void> {
  section("tool calling 完整两转");
  const userQuestion = "北京和上海分别是什么天气？";
  const first = await client.complete(
    request("tool_round1", userQuestion, { tools: [WEATHER_TOOL] }),
  );
  assert.ok(first.ok, first.error?.message);
  assert.equal(first.finishReason, "tool_calls");
  assert.ok(first.aiMessage);

  const history: ChatMessage[] = [
    ...first.request.messages,
    { type: "human", content: userQuestion },
    first.aiMessage,
  ];
  for (const toolCall of first.toolCalls) {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    const output = getCurrentWeather(args);
    console.log(
      `  工具执行: ${toolCall.function.name}(${toolCall.function.arguments}) -> ${output}`,
    );
    history.push({ type: "tool", content: output, toolCallId: toolCall.id });
  }

  const second = await client.complete(
    new ChatCompletionRequest({
      label: "tool_round2",
      inputMessage: "",
      messages: history,
      tools: [WEATHER_TOOL],
      toolChoice: "none",
    }),
  );
  assert.ok(second.ok, second.error?.message);
  assert.equal(second.finishReason, "stop");
  assert.ok(second.content.length > 0, "最终回复不应为空");
  printResult(second);
}

async function testAgentLoop(client: DeepSeekClient): Promise<void> {
  section("agentLoop() + thinking");
  const messages: ChatMessage[] = [SYSTEM];
  const result = await agentLoop({
    name: "tool_think",
    inputMessage: "广州今天天气怎么样？适合出门吗？",
    messages,
    tools: [WEATHER_TOOL],
    handlers: { get_current_weather: getCurrentWeather },
    thinking: true,
    service: client,
  });

  assert.ok(result.ok, "agentLoop 应成功完成");
  assert.ok(messages.length > 1, "agentLoop 应原地追加消息");
  console.log(getBufferString(messages, { renderToolCalls: true }));
}

async function testMultiTool(client: DeepSeekClient): Promise<void> {
  section("单次 response 内多工具调用");
  const result = await client.complete(
    request("test_tool_multi", "北京和上海分别是什么天气？", { tools: [WEATHER_TOOL] }),
  );
  assert.ok(result.ok, result.error?.message);
  assert.equal(result.finishReason, "tool_calls");
  assert.ok(result.toolCalls.length >= 2, `预期 >=2 个工具调用，实际 ${result.toolCalls.length}`);
  const cities = new Set(
    result.toolCalls.map((toolCall) => {
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      return typeof args.city === "string" ? args.city : "";
    }),
  );
  assert.ok(cities.has("北京") && cities.has("上海"), `城市集合不完整: ${[...cities].join(", ")}`);
  console.log(`工具调用数: ${result.toolCalls.length}`);
}

async function testModelMatrix(client: DeepSeekClient): Promise<void> {
  section("模型矩阵（flash/pro × thinking off/on）");
  const cases = [
    { model: DEEPSEEK_MODEL_FLASH, thinking: false },
    { model: DEEPSEEK_MODEL_FLASH, thinking: true },
    { model: DEEPSEEK_MODEL_PRO, thinking: false },
    { model: DEEPSEEK_MODEL_PRO, thinking: true },
  ];
  const requests = cases.map(({ model, thinking }) =>
    request(`${model}__thinking=${String(thinking)}`, "请用一句话解释什么是递归。", {
      model,
      thinking,
    }),
  );

  const results = await batchComplete(requests, { service: client });
  for (const result of results) {
    assert.ok(result.ok, result.error?.message);
    console.log(`\n[${result.label}]`);
    printResult(result);
  }
}

async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未设置；请在仓库根目录 .env 中配置后重试。");
    process.exitCode = 1;
    return;
  }

  const client = new DeepSeekClient({ logger: consoleLogger });
  testGetBufferString();
  await testListModels(client);
  await testGetBalance(client);
  await testChat(client);
  await testUsage(client);
  await testBatch(client);
  await testToolCallSingle(client);
  await testToolFullRound(client);
  await testAgentLoop(client);

  if (FULL) {
    await testMultiTool(client);
    await testModelMatrix(client);
  }

  console.log("\n✅ DeepSeek smoke 全部通过");
}

main().catch((error: unknown) => {
  console.error("\n❌ DeepSeek smoke 失败：", error);
  process.exitCode = 1;
});

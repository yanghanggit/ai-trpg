import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD, CROW_GRAVE_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMemories, getGameStateSlice, runActorTurn } from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { EMBEDDING_DIMENSIONS } from "../src/rag/constants";
import { DeterministicEmbeddingProvider } from "../src/rag/embeddings";
import { worldCollection } from "../src/rag/knowledge";
import { deleteCollection, indexDocuments, searchDocuments } from "../src/rag/store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function vector(index = 0): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, position) =>
    position === index ? 1 : 0,
  );
}

class KnowledgeService implements ChatCompletionService {
  private round = 0;
  /** 每次请求的完整消息，用来验证工具结果确实回到了 loop。 */
  readonly requests: { messages: readonly { type: string; content: string }[] }[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.round += 1;
    this.requests.push({ messages: request.messages });
    const toolCalls: ToolCall[] =
      this.round === 1
        ? [
            {
              id: randomUUID(),
              type: "function",
              function: {
                name: "query",
                arguments: JSON.stringify({ keywords: "尸体 处理" }),
              },
            },
          ]
        : [
            {
              id: randomUUID(),
              type: "function",
              function: { name: "wait", arguments: "{}" },
            },
            {
              id: randomUUID(),
              type: "function",
              function: { name: "submit_plan", arguments: "{}" },
            },
          ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

describe.skipIf(!testDatabaseUrl)("knowledge retrieval tool", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("lets a native actor query public knowledge during its plan", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "知识检索工具测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const collection = worldCollection(created.world.contentKey, created.game.contentVersion);
    const provider = new DeterministicEmbeddingProvider({
      vectors: {
        "尸体 处理": vector(),
        "瘟疫最盛时，修士在墓园地面撒石灰，把尸体压进乱葬坑。": vector(),
      },
    });
    await indexDocuments(handle.db, provider, collection, [
      {
        content: "瘟疫最盛时，修士在墓园地面撒石灰，把尸体压进乱葬坑。",
        docType: "knowledge",
      },
    ]);

    const service = new KnowledgeService();
    const result = await runActorTurn(handle.db, created.game.slug, "奥德里克", {
      service,
      knowledgeProvider: provider,
    });
    expect(result.ok).toBe(true);

    // 检索结果作为 tool 消息回到第二轮请求；它不再写进长期记忆。
    const secondRound = service.requests[1]?.messages ?? [];
    const toolMessage = secondRound.find(
      (message) => message.type === "tool" && message.content.includes("世界知识检索"),
    );
    expect(toolMessage?.content).toContain("石灰");
    const memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "奥德里克",
    );
    expect(memory?.messages.some((message) => message.type === "tool")).toBe(false);
    // 这里借用了 seed 的真实 collection；测完清空，避免向测试库留下 orphan 文档。
    await deleteCollection(handle.db, collection);
  });

  it("persists actor knowledge access and scopes retrieval to it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "知识门槛测试局",
      world: CROW_GRAVE_WORLD,
    });
    const state = await getGameStateSlice(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const karl = actors.find((actor) => actor.key === "karl");
    const eli = actors.find((actor) => actor.key === "eli");
    expect(karl?.knowledgeAccess).toEqual(["收尸人"]);
    expect(eli?.knowledgeAccess).toEqual([]);

    const collection = worldCollection(created.world.contentKey, created.game.contentVersion);
    const provider = new DeterministicEmbeddingProvider({
      vectors: {
        "骨牌 划一道": vector(),
        "收尸人每收一具，就在骨牌上划一道。": vector(),
        "墓园的土很浅。": vector(1),
      },
    });
    await indexDocuments(handle.db, provider, collection, [
      { content: "收尸人每收一具，就在骨牌上划一道。", access: ["收尸人"] },
      { content: "墓园的土很浅。" },
    ]);

    const asKarl = await searchDocuments(handle.db, provider, {
      collection,
      query: "骨牌 划一道",
      topK: 5,
      access: karl?.knowledgeAccess ?? [],
    });
    expect(asKarl.map((result) => result.content)).toEqual([
      "收尸人每收一具，就在骨牌上划一道。",
      "墓园的土很浅。",
    ]);

    const asEli = await searchDocuments(handle.db, provider, {
      collection,
      query: "骨牌 划一道",
      topK: 5,
      access: eli?.knowledgeAccess ?? [],
    });
    expect(asEli.map((result) => result.content)).toEqual(["墓园的土很浅。"]);
    await deleteCollection(handle.db, collection);
  });
});

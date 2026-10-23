import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMemories, runNpcTurn } from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { EMBEDDING_DIMENSIONS } from "../src/rag/constants";
import { DeterministicEmbeddingProvider } from "../src/rag/embeddings";
import { worldCollection } from "../src/rag/knowledge";
import { indexDocuments } from "../src/rag/store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function vector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));
}

class KnowledgeService implements ChatCompletionService {
  private round = 0;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.round += 1;
    const toolCalls: ToolCall[] =
      this.round === 1
        ? [
            {
              id: randomUUID(),
              type: "function",
              function: {
                name: "query",
                arguments: JSON.stringify({ question: "尸体怎么处理" }),
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
      world: DARK_FANTASY_WORLD,
    });
    const collection = worldCollection(created.world.name, created.game.contentVersion);
    const provider = new DeterministicEmbeddingProvider({
      vectors: {
        尸体怎么处理: vector(),
        "瘟疫最盛时，修士在墓园地面撒石灰，把尸体压进乱葬坑。": vector(),
      },
    });
    await indexDocuments(handle.db, provider, collection, [
      {
        content: "瘟疫最盛时，修士在墓园地面撒石灰，把尸体压进乱葬坑。",
        docType: "knowledge",
      },
    ]);

    const result = await runNpcTurn(handle.db, created.game.slug, "角色.奥德里克", {
      service: new KnowledgeService(),
      knowledgeProvider: provider,
    });
    expect(result.ok).toBe(true);

    const memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "角色.奥德里克",
    );
    const toolMessage = memory?.messages.find(
      (message) => message.type === "tool" && message.content.includes("公共知识检索"),
    );
    expect(toolMessage?.content).toContain("石灰");
  });
});

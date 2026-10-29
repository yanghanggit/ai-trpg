import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  appendMemoryMessages,
  auditGameNameLeaks,
  createGame,
  findNameAudit,
  findNameLeaks,
  getGameMemories,
  getGameState,
  loadAgentMemory,
  nameAuditEnabled,
  playerMove,
  playerSay,
  renderNameLeakReport,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import { MEMORY_KINDS } from "../src/game/constants";
import type { NameAuditInput } from "../src/game/name-audit";
import type { AgentMemoryMessageState, AgentMemoryState } from "../src/game/types";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { allowAllDialogue } from "./test-dialogue-judge";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function message(
  content: string,
  patch: Partial<AgentMemoryMessageState> = {},
): AgentMemoryMessageState {
  return {
    sequence: 1,
    type: "human",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function memory(
  actorId: string,
  name: string,
  messages: AgentMemoryMessageState[],
): AgentMemoryState {
  return {
    id: `memory-${actorId}`,
    ownerType: "actor",
    ownerId: actorId,
    name,
    contextUsageRatio: 0,
    messages,
  };
}

const OBSERVER = { id: "a", name: "煤渣", currentPresentationId: "pa" };
const SUBJECT = { id: "b", name: "奥德里克", currentPresentationId: "pb" };

function baseInput(
  messages: AgentMemoryMessageState[],
  recognitions: NameAuditInput["recognitions"] = [],
): NameAuditInput {
  return {
    actors: [OBSERVER, SUBJECT],
    presentations: [
      { id: "pa", actorId: "a" },
      { id: "pb", actorId: "b" },
    ],
    recognitions,
    memories: [memory("a", "煤渣", messages)],
  };
}

describe("name audit", () => {
  it("finds an unknown true name in an observation", () => {
    const leaks = findNameLeaks(
      baseInput([
        message("你看见奥德里克站在门口。", {
          metadata: { kind: MEMORY_KINDS.actionObservation },
        }),
      ]),
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      observerName: "煤渣",
      matchedName: "奥德里克",
      severity: "high",
      form: "bare",
      part: "content",
      messageKind: MEMORY_KINDS.actionObservation,
    });
    expect(leaks[0]?.excerpt).toContain("奥德里克");
  });

  it("flags an @reference as a reference and keeps it high severity", () => {
    const leaks = findNameLeaks(baseInput([message("你对@奥德里克点头。")]));
    expect(leaks[0]).toMatchObject({ matchedName: "奥德里克", form: "reference" });
  });

  it("ignores names the observer has learned", () => {
    const leaks = findNameLeaks(
      baseInput(
        [message("你看见奥德里克站在门口。")],
        [{ observerActorId: "a", presentationId: "pb" }],
      ),
    );
    expect(leaks).toEqual([]);
  });

  it("ignores the observer's own name", () => {
    const leaks = findNameLeaks(baseInput([message("你记得自己叫煤渣。")]));
    expect(leaks).toEqual([]);
  });

  it("supports content-level allowlist names", () => {
    const input = baseInput([message("一个无名者走过。")], []);
    input.actors = [
      { id: "a", name: "煤渣", currentPresentationId: "pa" },
      { id: "b", name: "无名者", currentPresentationId: "pb" },
    ];
    expect(findNameLeaks(input, { allowNames: ["无名者"] })).toEqual([]);
  });

  it("skips the system prompt by default and includes it on request", () => {
    const input = baseInput([
      message("奥德里克站在墓园里。", {
        type: "system",
        metadata: { kind: MEMORY_KINDS.actorSystemPrompt },
      }),
    ]);
    expect(findNameLeaks(input)).toEqual([]);
    expect(findNameLeaks(input, { skipKinds: [] })[0]).toMatchObject({
      matchedName: "奥德里克",
      severity: "low",
    });
  });

  it("separates ever-known from current-presentation recognition", () => {
    const input: NameAuditInput = {
      actors: [
        { id: "a", name: "煤渣", currentPresentationId: "pa" },
        { id: "b", name: "奥德里克", currentPresentationId: "pb-new" },
      ],
      presentations: [
        { id: "pa", actorId: "a" },
        { id: "pb-old", actorId: "b" },
        { id: "pb-new", actorId: "b" },
      ],
      recognitions: [{ observerActorId: "a", presentationId: "pb-old" }],
      memories: [memory("a", "煤渣", [message("你想起奥德里克。")])],
    };
    expect(findNameLeaks(input)).toEqual([]);
    expect(findNameLeaks(input, { recognitionScope: "currentPresentation" })[0]).toMatchObject({
      matchedName: "奥德里克",
    });
  });

  it("does not report a name the observer already recognizes", () => {
    const input: NameAuditInput = {
      actors: [
        { id: "a", name: "甲", currentPresentationId: "pa" },
        { id: "b", name: "乙", currentPresentationId: "pb" },
      ],
      presentations: [
        { id: "pa", actorId: "a" },
        { id: "pb", actorId: "b" },
      ],
      recognitions: [{ observerActorId: "a", presentationId: "pb" }],
      memories: [memory("a", "甲", [message("乙走了过来。")])],
    };
    expect(findNameLeaks(input)).toEqual([]);
  });

  it("scans toolCalls and marks them medium severity", () => {
    const toolCalls: ToolCall[] = [
      {
        id: "call-1",
        type: "function",
        function: { name: "say", arguments: JSON.stringify({ message: "奥德里克" }) },
      },
    ];
    const leaks = findNameLeaks(baseInput([message("", { type: "ai", toolCalls })], []));
    expect(leaks[0]).toMatchObject({
      matchedName: "奥德里克",
      part: "tool_calls",
      severity: "medium",
    });
  });

  it("classifies a say leak by communication kind and dialogue position", () => {
    const dialogue = "奥德里克，你听着。";
    const leaks = findNameLeaks(
      baseInput([
        message(`# 你听见\n#3对你说（场景：墓园）：${dialogue}`, {
          metadata: {
            kind: MEMORY_KINDS.communicationObservation,
            communicationKind: "say",
            dialogue,
          },
        }),
      ]),
    );
    expect(leaks[0]).toMatchObject({
      matchedName: "奥德里克",
      communicationKind: "say",
      inDialogue: true,
    });
  });

  it("distinguishes whisper and announce", () => {
    const cases = [
      { communicationKind: "whisper" as const, dialogue: "奥德里克在门外。" },
      { communicationKind: "announce" as const, dialogue: "奥德里克已经死了。" },
    ];
    for (const item of cases) {
      const leaks = findNameLeaks(
        baseInput([
          message(`# 你听见\n${item.dialogue}`, {
            metadata: {
              kind: MEMORY_KINDS.communicationObservation,
              communicationKind: item.communicationKind,
              dialogue: item.dialogue,
            },
          }),
        ]),
      );
      expect(leaks[0]).toMatchObject({
        communicationKind: item.communicationKind,
        inDialogue: true,
      });
    }
  });

  it("marks a name outside the structured dialogue as not in dialogue", () => {
    const dialogue = "你好。";
    const leaks = findNameLeaks(
      baseInput([
        message(`# 你听见\n#3对你说（场景：墓园）：${dialogue}\n\n奥德里克站在旁边。`, {
          metadata: {
            kind: MEMORY_KINDS.communicationObservation,
            communicationKind: "say",
            dialogue,
          },
        }),
      ]),
    );
    expect(leaks[0]).toMatchObject({
      matchedName: "奥德里克",
      communicationKind: "say",
      inDialogue: false,
    });
  });

  it("classifies a dialogue action feedback as say without alerting", () => {
    const dialogue = "奥德里克，你听着。";
    const result = findNameAudit(
      baseInput([
        message(`# 行动结果\n你对#3说（场景：墓园）：${dialogue}`, {
          metadata: {
            kind: MEMORY_KINDS.actionFeedback,
            communicationKind: "say",
            dialogue,
          },
        }),
      ]),
    );
    expect(result.alerts).toEqual([]);
    expect(result.leaks[0]).toMatchObject({
      matchedName: "奥德里克",
      communicationKind: "say",
      inDialogue: true,
    });
  });

  it("alerts when a dialogue action feedback has only half the structure", () => {
    const result = findNameAudit(
      baseInput([
        message("你对#3说：奥德里克。", {
          metadata: { kind: MEMORY_KINDS.actionFeedback, communicationKind: "say" },
        }),
      ]),
    );
    expect(result.alerts[0]).toMatchObject({
      code: "missing_dialogue_structure",
      missing: ["dialogue"],
    });
  });

  it("alerts when a communication observation lacks dialogue structure", () => {
    const result = findNameAudit(
      baseInput([
        message("# 你听见\n#3对你说（场景：墓园）：奥德里克。", {
          metadata: { kind: MEMORY_KINDS.communicationObservation },
        }),
      ]),
    );
    expect(result.alerts[0]).toMatchObject({
      code: "missing_dialogue_structure",
      missing: ["communicationKind", "dialogue"],
    });
    // 告警不代替泄漏检查：正文仍会被扫描。
    expect(result.leaks[0]).toMatchObject({ matchedName: "奥德里克" });
  });

  it("alerts when a non-communication message carries dialogue fields", () => {
    const result = findNameAudit(
      baseInput([
        message("普通观察。", {
          metadata: {
            kind: MEMORY_KINDS.actionObservation,
            dialogue: "奥德里克。",
          },
        }),
      ]),
    );
    expect(result.alerts[0]).toMatchObject({ code: "unexpected_dialogue_structure" });
  });

  it("filters messages older than since", () => {
    const input = baseInput([
      message("奥德里克站在门口。", { createdAt: "2025-01-01T00:00:00.000Z" }),
    ]);
    expect(findNameLeaks(input, { since: "2026-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("renders a human-readable report", () => {
    const leaks = findNameLeaks(baseInput([message("你看见奥德里克站在门口。")]));
    const text = renderNameLeakReport({
      gameId: "demo",
      leaks,
      alerts: [],
      checked: { actors: 2, messages: 1, recognitionRows: 0 },
    });
    expect(text).toContain("名字审计");
    expect(text).toContain("奥德里克");
  });

  it("reads the runtime audit switch", () => {
    expect(nameAuditEnabled({ TRPG_AUDIT_NAMES: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(nameAuditEnabled({ TRPG_AUDIT_NAMES: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(nameAuditEnabled({ TRPG_AUDIT_NAMES: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(nameAuditEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

/** 只提交 wait 的假服务；回合级审计测试不关心计划内容。 */
class WaitService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls: ToolCall[] = [
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

describe.skipIf(!testDatabaseUrl)("name audit (database)", () => {
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

  const createMonasteryGame = async (name: string) =>
    createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: BELL_MONASTERY_WORLD,
    });

  const actorByName = async (gameRef: string, name: string) => {
    const state = await getGameState(handle.db, gameRef);
    const actor = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === name);
    if (!actor) {
      throw new Error(`缺少 actor: ${name}`);
    }
    return actor;
  };

  const appendLeak = async (gameId: string, actorId: string) => {
    const memoryRow = await loadAgentMemory(handle.db, gameId, "actor", actorId);
    if (!memoryRow) {
      throw new Error("缺少 memory");
    }
    await appendMemoryMessages(handle.db, memoryRow.row.id, [
      {
        type: "human",
        content: "你想起坏运气在墓园里。",
        metadata: { kind: MEMORY_KINDS.actionObservation },
      },
    ]);
  };

  it("finds a leak injected into an actor memory", async () => {
    const created = await createMonasteryGame("名字审计注入测试局");
    const cinder = await actorByName(created.game.slug, "煤渣");

    const clean = await auditGameNameLeaks(handle.db, created.game.slug);
    expect(clean.checked.actors).toBe(5);
    expect(clean.leaks).toEqual([]);

    await appendLeak(created.game.id, cinder.id);
    const report = await auditGameNameLeaks(handle.db, created.game.slug);
    const leak = report.leaks.find(
      (candidate) => candidate.observerName === "煤渣" && candidate.matchedName === "坏运气",
    );
    expect(leak).toMatchObject({
      severity: "high",
      form: "bare",
      part: "content",
      messageKind: MEMORY_KINDS.actionObservation,
    });
  });

  it("includes content-layer settings when skipKinds is empty", async () => {
    const created = await createMonasteryGame("名字审计内容层测试局");
    const report = await auditGameNameLeaks(handle.db, created.game.slug, { skipKinds: [] });
    // 坏运气认得鼠王，因此 profile 里出现「鼠王」不算越界。
    expect(
      report.leaks.some((leak) => leak.observerName === "坏运气" && leak.matchedName === "鼠王"),
    ).toBe(false);
    expect(
      report.leaks.some(
        (leak) => leak.observerName === "坏运气" && leak.matchedName === "奥德里克",
      ),
    ).toBe(true);
  });

  it("classifies a say leak from a player dialogue", async () => {
    const created = await createMonasteryGame("名字审计台词测试局");
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });
    const said = await playerSay(
      handle.db,
      created.game.slug,
      "无名者",
      {
        targetActorRef: "奥德里克",
        message: "奥德里克，你听着。",
      },
      { judge: allowAllDialogue },
    );
    expect(said.ok).toBe(true);

    const report = await auditGameNameLeaks(handle.db, created.game.slug);
    const leak = report.leaks.find(
      (candidate) => candidate.observerName === "坏运气" && candidate.matchedName === "奥德里克",
    );
    expect(leak).toMatchObject({
      communicationKind: "say",
      inDialogue: true,
      severity: "high",
    });

    const memories = await getGameMemories(handle.db, created.game.id);
    const badLuck = memories.find((memory) => memory.name === "坏运气");
    const communication = badLuck?.messages.find((item) => {
      const metadata = item.metadata as Record<string, unknown> | undefined;
      return (
        metadata?.kind === MEMORY_KINDS.communicationObservation &&
        metadata.dialogue === "奥德里克，你听着。"
      );
    });
    expect(communication?.metadata).toMatchObject({
      communicationKind: "say",
      dialogue: "奥德里克，你听着。",
    });
  });

  it("writes a warning when the runtime audit is enabled", async () => {
    const created = await createMonasteryGame("名字审计回合测试局");
    const cinder = await actorByName(created.game.slug, "煤渣");
    await appendLeak(created.game.id, cinder.id);

    const warn = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
    const turn = await runNpcTurn(handle.db, created.game.slug, "奥德里克", {
      service: new WaitService(),
      auditNameLeaks: true,
      logger,
    });
    expect(turn.ok).toBe(true);

    const leakCall = warn.mock.calls.find(([label]) => label === "名字泄漏");
    expect(leakCall?.[1]).toMatchObject({
      observerName: "煤渣",
      matchedName: "坏运气",
      severity: "high",
    });
  });

  it("does not write warnings when the runtime audit is off", async () => {
    const created = await createMonasteryGame("名字审计关闭测试局");
    const cinder = await actorByName(created.game.slug, "煤渣");
    await appendLeak(created.game.id, cinder.id);

    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const turn = await runNpcTurn(handle.db, created.game.slug, "奥德里克", {
      service: new WaitService(),
      auditNameLeaks: false,
      logger,
    });
    expect(turn.ok).toBe(true);
    expect(warn.mock.calls.some(([label]) => label === "名字泄漏")).toBe(false);
  });
});

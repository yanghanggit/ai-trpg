import { createTurnTrace, traceEvent } from "../../../debug/trace";
import { agentLoop, DEFAULT_ERROR_RETRIES } from "../../../llm";
import { DEFAULT_STORY_MAX_ROUNDS } from "../../default-rounds";
import { GameError } from "../../errors";
import { getGameState } from "../../game-state";
import { getGameMemories } from "../../memory";
import { buildStoryInput, buildStorySystemPrompt } from "./prompt";
import {
  buildListMemoriesTool,
  buildReadEventsTool,
  buildReadMemoryTool,
  buildSubmitStoryTool,
} from "./tools";
import type { StoryOptions, StoryResult } from "./types";
import { renderEventStream, renderMemoryList, renderMemoryRead, resolveMemory } from "./view";

/**
 * 故事整理回合：一次 agent loop，读全局后交一段正文。
 *
 * 提交前强制「每个实体记忆都读过 + 事件流读过」——故事要能解释关键因果，
 * 而因果分散在不同实体的记忆里。失败不写任何东西：它只产出文本，不参与游戏状态。
 */

/** 记忆键：`ownerType:name`，用来记录哪些实体已经读过。 */
function memoryKey(ownerType: string, name: string): string {
  return `${ownerType}:${name}`;
}

export async function runStory(
  db: Parameters<typeof getGameMemories>[0],
  gameRef: string,
  options: StoryOptions,
): Promise<StoryResult> {
  const state = await getGameState(db, gameRef);
  const memories = await getGameMemories(db, state.game.id);
  const readKeys = new Set<string>();
  let eventsRead = false;
  let story: string | null = null;

  const trace = createTurnTrace({ game: state.game, turnKind: "story" });
  await traceEvent(trace, {
    event: "turn_start",
    label: "story",
    contentVersion: state.game.contentVersion,
  });

  const listTool = buildListMemoriesTool();
  const readTool = buildReadMemoryTool();
  const eventsTool = buildReadEventsTool();
  const submitTool = buildSubmitStoryTool();

  const loop = await agentLoop({
    name: "story",
    inputMessage: buildStoryInput(state, memories),
    messages: [{ type: "system", content: buildStorySystemPrompt(state.world) }],
    tools: [listTool, readTool, eventsTool, submitTool],
    terminalTools: [submitTool],
    maxRounds: options.maxRounds ?? DEFAULT_STORY_MAX_ROUNDS,
    service: options.service,
    errorRetries: DEFAULT_ERROR_RETRIES,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
    handlers: {
      [listTool.function.name]: () => renderMemoryList(memories),
      [readTool.function.name]: (args) => {
        const ownerType = typeof args.ownerType === "string" ? args.ownerType : "";
        const name = typeof args.name === "string" ? args.name : "";
        const memory = resolveMemory(memories, ownerType, name);
        readKeys.add(memoryKey(memory.ownerType, memory.name));
        return renderMemoryRead(state, memory, args.includeArchived === true);
      },
      [eventsTool.function.name]: () => {
        eventsRead = true;
        return renderEventStream(state);
      },
      [submitTool.function.name]: (args) => {
        const text = typeof args.story === "string" ? args.story.trim() : "";
        if (text.length === 0) {
          throw new GameError("invalid_action", "submit_story 需要非空 story");
        }
        const missing = memories
          .map((memory) => memoryKey(memory.ownerType, memory.name))
          .filter((key) => !readKeys.has(key));
        if (missing.length > 0) {
          throw new GameError("invalid_action", `还有未读取的实体记忆: ${missing.join(", ")}`);
        }
        if (!eventsRead) {
          throw new GameError("invalid_action", "提交前必须先调用 read_events");
        }
        story = text;
        return "story 已提交";
      },
    },
  });

  if (!loop.success || !story) {
    throw new GameError("invalid_state", "story agent 未能提交故事");
  }

  await traceEvent(trace, { event: "turn_end", ok: story !== null, loopSuccess: loop.success });

  return {
    gameId: state.game.id,
    gameName: state.game.name,
    gameSlug: state.game.slug,
    gameStatus: state.game.status,
    contentVersion: state.game.contentVersion,
    version: state.game.version,
    story,
    rounds: loop.rounds.length,
    memoriesRead: [...readKeys],
    eventsRead,
  };
}

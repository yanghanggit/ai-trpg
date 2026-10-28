import { createTurnTrace, traceEvent } from "../debug/trace";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import { findActorWithStage, findStage } from "./actors";
import { GameError } from "./errors";
import { getGameMemories } from "./memory";
import { getGameState } from "./service";
import type { AgentMemoryMessageState, AgentMemoryState, GameState } from "./types";

export type StoryOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

export type StoryResult = {
  gameId: string;
  gameName: string;
  gameSlug: string;
  gameStatus: string;
  contentVersion: string;
  version: number;
  story: string;
  rounds: number;
  memoriesRead: string[];
  eventsRead: boolean;
};

const DEFAULT_STORY_MAX_ROUNDS = 10;

function memoryKey(ownerType: string, name: string): string {
  return `${ownerType}:${name}`;
}

function asArchivedMessages(metadata: unknown): AgentMemoryMessageState[] | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>).compactedMessages;
  return Array.isArray(value) ? (value as AgentMemoryMessageState[]) : undefined;
}

function archivedCount(memory: AgentMemoryState): number {
  return memory.messages.reduce(
    (total, message) => total + (asArchivedMessages(message.metadata)?.length ?? 0),
    0,
  );
}

function formatMessage(
  message: AgentMemoryMessageState,
  options: { includeArchived: boolean; depth: number },
): string[] {
  const indent = "  ".repeat(options.depth);
  const lines = [`${indent}[${message.type}] ${message.content}`];
  if (!options.includeArchived) {
    return lines;
  }
  const archived = asArchivedMessages(message.metadata);
  if (!archived) {
    return lines;
  }
  lines.push(`${indent}  ↳ 归档：${archived.length} 条旧消息`);
  for (const old of archived) {
    lines.push(...formatMessage(old, { includeArchived: true, depth: options.depth + 2 }));
  }
  return lines;
}

function formatMemory(memory: AgentMemoryState, includeArchived: boolean): string {
  const lines = [`# ${memory.ownerType}: ${memory.name}`, ""];
  for (const message of memory.messages) {
    if (message.type === "system") {
      continue;
    }
    lines.push(...formatMessage(message, { includeArchived, depth: 0 }));
  }
  if (memory.messages.every((message) => message.type === "system")) {
    lines.push("（暂无运行记忆）");
  }
  if (!includeArchived && archivedCount(memory) > 0) {
    lines.push("", `（另有 ${archivedCount(memory)} 条历史归档，可用 includeArchived 展开）`);
  }
  return lines.join("\n");
}

function resolveMemory(
  memories: readonly AgentMemoryState[],
  ownerType: string,
  name: string,
): AgentMemoryState {
  const found = memories.find((memory) => memory.ownerType === ownerType && memory.name === name);
  if (!found) {
    throw new GameError("invalid_action", `找不到记忆实体: ${ownerType}:${name}`);
  }
  return found;
}

function entityProfile(state: GameState, ownerType: string, name: string): string {
  switch (ownerType) {
    case "actor":
      return findActorWithStage(state, name).actor.profile;
    case "stage":
      return findStage(state, name).profile;
    case "world":
      return state.world.campaignSetting;
    default:
      throw new GameError("invalid_action", `未知实体类型: ${ownerType}`);
  }
}

function buildListMemoriesTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "list_memories",
      description: "列出本局所有实体记忆，包括 world、每个 stage 与每个 actor。",
      parameters: { type: "object", properties: {} },
    },
  };
}

function buildReadMemoryTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "read_memory",
      description:
        "读取一个实体的记忆。必须读取 list_memories 返回的每一个实体；默认只读当前摘要，includeArchived=true 可展开 compact 归档树。",
      parameters: {
        type: "object",
        properties: {
          ownerType: {
            type: "string",
            enum: ["world", "stage", "actor"],
            description: "实体类型",
          },
          name: {
            type: "string",
            description: "实体名称，必须来自 list_memories",
          },
          includeArchived: {
            type: "boolean",
            description: "是否展开 compact 归档的旧消息树；默认 false",
          },
        },
        required: ["ownerType", "name"],
      },
    },
  };
}

function buildReadEventsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "read_events",
      description: "读取本局全部公共与私密事件流，按 sequence 排序。",
      parameters: { type: "object", properties: {} },
    },
  };
}

function buildSubmitStoryTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_story",
      description: "提交最终故事总结并结束。",
      parameters: {
        type: "object",
        properties: {
          story: {
            type: "string",
            description: "一段完整、连贯的故事总结，不是分析报告或工具说明",
          },
        },
        required: ["story"],
      },
    },
  };
}

function buildStoryInput(state: GameState, memories: readonly AgentMemoryState[]): string {
  return `# 当前游戏

- 游戏：${state.game.name}
- slug：${state.game.slug}
- 状态：${state.game.status}
- 内容版本：${state.game.contentVersion}
- 版本号：${state.game.version}

本局共有 ${memories.length} 个实体记忆。请先调用 list_memories，再读取每一个实体，最后读取事件流并提交故事。

游戏可能仍在进行，也可能已经结束；只根据当前已经发生的记忆和事件写作，不要虚构尚未发生的结局。

# 工作顺序

1. list_memories；
2. 对每一个 world / stage / actor 调用 read_memory；如果摘要不足以理解关键因果，可用 includeArchived 展开归档；
3. read_events；
4. 综合所有视角，调用 submit_story。

不要跳过任何实体，不要把单个角色的误解当作客观事实，不要编造未出现的事件。`;
}

const STORY_SYSTEM_PROMPT = `你是本局游戏的叙事整理者，不是世界内角色，也不属于任何一个 actor / stage / world。

你的任务是把本局所有实体的私有记忆与事件流整理成一段完整、连贯的故事。游戏可能仍在进行，也可能已经结束；只写已经发生的内容，不要虚构尚未发生的结局。故事应有清楚的开头、发展、冲突与当前阶段的收束，能解释关键角色为什么行动。

你必须遵守：
- 只使用工具返回的记忆和事件；
- 综合不同实体的视角，区分客观事件、角色认知与误解；
- 保留关键因果、关系、物品、地点和结局；
- 不编造未出现的事实，不补充未经记忆支持的心理活动；
- 最终通过 submit_story 提交一段故事，而不是提交提纲。

最终故事必须是故事内叙事，不是开发报告：
- 禁止出现“场景”“世界”“系统”“裁决”“报告”“工具”“记忆”“memory”“stage”“actor”“测试目标”等元语言；
- 禁止使用“角色.xxx”“场景.xxx”“世界.xxx”这类规范名；叙述时使用自然称呼或去掉类型前缀；
- 把场景/世界的通知与裁决改写成故事世界中实际发生的事件，不要解释“谁向谁报告、谁如何裁决”；
- 不解释机制、不逐条复述事件，只写读者能读到的一段连贯故事。`;

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
    messages: [{ type: "system", content: STORY_SYSTEM_PROMPT }],
    tools: [listTool, readTool, eventsTool, submitTool],
    terminalTools: [submitTool],
    maxRounds: options.maxRounds ?? DEFAULT_STORY_MAX_ROUNDS,
    service: options.service,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(trace ? { trace } : {}),
    handlers: {
      [listTool.function.name]: () =>
        memories
          .map((memory) => {
            const archive = archivedCount(memory);
            return `${memory.ownerType} | ${memory.name} | messages=${memory.messages.length} | ratio=${memory.contextUsageRatio.toFixed(4)} | archived=${archive}`;
          })
          .join("\n"),
      [readTool.function.name]: (args) => {
        const ownerType = typeof args.ownerType === "string" ? args.ownerType : "";
        const name = typeof args.name === "string" ? args.name : "";
        const memory = resolveMemory(memories, ownerType, name);
        readKeys.add(memoryKey(memory.ownerType, memory.name));
        const profile = entityProfile(state, memory.ownerType, memory.name);
        return `# ${memory.ownerType}: ${memory.name}\n\n## 实体设定\n${profile}\n\n## 记忆\n${formatMemory(
          memory,
          args.includeArchived === true,
        )}`;
      },
      [eventsTool.function.name]: () => {
        eventsRead = true;
        const actors = new Map(
          state.world.stages.flatMap((stage) =>
            stage.actors.map((actor) => [actor.id, actor.name] as const),
          ),
        );
        const stages = new Map(state.world.stages.map((stage) => [stage.id, stage.name] as const));
        return state.messages
          .map((message) => {
            const stage = message.stageId ? (stages.get(message.stageId) ?? message.stageId) : "-";
            const source = message.sourceActorId
              ? (actors.get(message.sourceActorId) ?? message.sourceActorId)
              : "-";
            const target = message.targetActorId
              ? (actors.get(message.targetActorId) ?? message.targetActorId)
              : "-";
            return `[${message.sequence}] ${message.kind} | stage=${stage} | source=${source} | target=${target} | visibility=${message.visibility}\n${message.content}`;
          })
          .join("\n\n");
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

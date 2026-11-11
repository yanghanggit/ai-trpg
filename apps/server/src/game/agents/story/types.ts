import type { agentLoop, ChatCompletionService } from "../../../llm";

/**
 * 故事整理的输入输出：跑一次，交一段正文。
 *
 * 结果里带着这次读了哪些记忆、有没有读事件流——复盘时能确认 agent 真的看过全局，
 * 而不是只照着 world 的名字编。
 */

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

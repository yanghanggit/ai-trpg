import type { components } from "@ai-trpg/api-client";
import type { AdvanceInput } from "../../features/games/useGameActions";
import type { MemoryOwner, MessageView } from "../../features/games/useGameData";

export type MemoryQuery = { owner: MemoryOwner; name?: string };

/** 事件流页：整屏一张表，自带自动刷新开关。 */
export type GameMessagesData = {
  slug: string;
  autoRefresh: boolean;
  messages?: MessageView[];
  messagesError?: string;
};

/** 建局数据：形状来自契约，行是不收窄的原始列。 */
export type GameBuild = components["schemas"]["GameBuild"];

export type GameBuildData = {
  slug: string;
  build?: GameBuild;
  buildError?: string;
};

/** 局控制台的展示数据；动作与数据都由容器给，页面不碰网络。 */
export type GamePageData = {
  slug: string;
  busy?: string;
  actionError?: string;

  /** 刚入队的作业 id：只回一行回执，不再摊开作业表。 */
  queuedJobId?: string;

  memory?: { query: MemoryQuery; payload: unknown };
  memoryError?: string;
  leaks?: unknown;
  leaksError?: string;
  probeResult?: unknown;
  /** 快照 / 故事这类「跑一次、回一份结果」的产物。 */
  auxResult?: { title: string; payload: unknown };
};

export type GamePageActions = {
  refresh: () => Promise<void>;
  /** 事件流与建局数据各自一页：控制台是这一局的枢纽，只留入口。 */
  openMessages: () => void;
  openBuild: () => void;
  advance: (input: AdvanceInput) => Promise<void>;
  pass: (actors: string[]) => Promise<void>;
  endGame: (input: { outcome: string; message?: string }) => Promise<void>;
  deleteGame: () => Promise<void>;
  compact: (input: { owner: MemoryOwner | "all"; name?: string }) => Promise<void>;
  probe: (input: { message: string; actor?: string; stage?: string }) => Promise<void>;
  snapshot: () => Promise<void>;
  story: () => Promise<void>;
  loadMemory: (query: MemoryQuery) => void;
  loadLeaks: () => void;
};

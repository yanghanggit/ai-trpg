import type { components } from "@ai-trpg/api-client";
import type { AdvanceInput } from "../../features/games/useGameActions";
import type { MemoryOwner, MessageView } from "../../features/games/useGameData";

export type MemoryQuery = { owner: MemoryOwner; name?: string };

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
  /** 事件流是不是按 5 秒自动重读。 */
  autoRefresh: boolean;

  messages?: MessageView[];
  messagesError?: string;
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
  toggleAutoRefresh: () => void;
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

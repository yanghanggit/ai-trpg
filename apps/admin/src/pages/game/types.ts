import type { components } from "@ai-trpg/api-client";
import type { AdvanceInput } from "../../features/games/useGameActions";
import type { JobView, MemoryOwner, MessageView } from "../../features/games/useGameData";
import type { TraceTurn } from "../../features/traces/traceIndex";

export type MemoryQuery = { owner: MemoryOwner; name?: string };

/** 建局数据：形状来自契约，行是不收窄的原始列。 */
export type GameBuild = components["schemas"]["GameBuild"];

export type GameBuildData = {
  slug: string;
  build?: GameBuild;
  buildError?: string;
};

/** 局控制台的全部展示数据；形状与动作都由容器给，页面不碰网络。 */
export type GamePageData = {
  slug: string;
  busy?: string;
  actionError?: string;

  messages?: MessageView[];
  messagesError?: string;

  jobs?: JobView[];
  jobsError?: string;
  /** 这一次写入产生的作业：盯到终态才算数。 */
  watchedJob?: JobView;

  turns?: TraceTurn[];
  turnsError?: string;
  selectedTurnId?: string;
  turnEvents?: Record<string, unknown>[];

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
  cancelJob: (jobId: string) => Promise<void>;
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
  selectTurn: (turnId: string | undefined) => void;
};

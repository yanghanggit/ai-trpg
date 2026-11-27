import type { components } from "@ai-trpg/api-client";
import type { AdvanceInput } from "../../features/games/useGameActions";
import type { MemoryOwner, MessageView } from "../../features/games/useGameData";
import type { GameGraph } from "../../features/games/useGameGraph";

export type MemoryQuery = { owner: MemoryOwner; name?: string };

/** 事件流页：整屏一张表；自动刷新是全局开关，不在这一页存状态。 */
export type GameMessagesData = {
  slug: string;
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

export type GameSnapshotEntry = components["schemas"]["GameSnapshotEntry"];
export type GameStoryEntry = components["schemas"]["GameStoryEntry"];

/** 快照清单页。 */
export type GameSnapshotsData = {
  slug: string;
  dir?: string;
  snapshots?: GameSnapshotEntry[];
  snapshotsError?: string;
  busy?: string;
  actionError?: string;
  /** 刚落下的那一份：写在哪。 */
  lastPath?: string;
};

/** 一份快照：清单 + 按份读到的原文。 */
export type GameSnapshotData = {
  slug: string;
  snapshotId: string;
  manifest?: Record<string, unknown>;
  parts: string[];
  part: string | null;
  content?: string;
  snapshotError?: string;
  loading: boolean;
};

/** 故事清单页。 */
export type GameStoriesData = {
  slug: string;
  dir?: string;
  stories?: GameStoryEntry[];
  storiesError?: string;
  busy?: string;
  actionError?: string;
  lastPath?: string;
};

/** 一份故事原文。 */
export type GameStoryData = {
  slug: string;
  name: string;
  content?: string;
  path?: string;
  storyError?: string;
};

/** 局控制台的展示数据；动作与数据都由容器给，页面不碰网络。 */
export type GamePageData = {
  slug: string;
  busy?: string;
  actionError?: string;

  /** 刚入队的作业 id：只回一行回执，不再摊开作业表。 */
  queuedJobId?: string;

  /** 世界图谱：舞台、actor 与当前顺位的上帝视角。 */
  graph?: GameGraph;
  graphError?: string;

  memory?: { query: MemoryQuery; payload: unknown };
  memoryError?: string;
  leaks?: unknown;
  leaksError?: string;
  /** 扫描结果进弹窗：按钮在顶部，报告不占主页面版面。 */
  leaksOpen: boolean;
  probeResult?: unknown;
};

export type GamePageActions = {
  refresh: () => Promise<void>;
  advance: (input: AdvanceInput) => Promise<void>;
  pass: (actors: string[]) => Promise<void>;
  endGame: (input: { outcome: string; message?: string }) => Promise<void>;
  deleteGame: () => Promise<void>;
  compact: (input: { owner: MemoryOwner | "all"; name?: string }) => Promise<void>;
  probe: (input: { message: string; actor?: string; stage?: string }) => Promise<void>;
  loadMemory: (query: MemoryQuery) => void;
  openLeaks: () => void;
  closeLeaks: () => void;
  rescanLeaks: () => void;
};

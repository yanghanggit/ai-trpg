import type { components } from "@ai-trpg/api-client";
import type { MessageView } from "../../features/games/useGameData";
import type { GameGraph } from "../../features/games/useGameGraph";
import type { MemoryTarget } from "./memory/targets";

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
export type GamePromptBundle = components["schemas"]["GamePromptBundle"];
export type GamePromptFile = components["schemas"]["GamePromptFile"];
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

export type GameMemoryPayload = components["schemas"]["GameMemory"];
export type GameMemoryMessage = components["schemas"]["GameMemoryMessage"];
export type GameProbeAnswer = components["schemas"]["GameProbe"];

/** 记忆页：选一个实体，读它的记忆，或对它发探针。 */
export type GameMemoryData = {
  slug: string;
  /** 可搜的实体清单，来自世界图谱那一份投影。 */
  targets: MemoryTarget[];
  target?: MemoryTarget;
  memory?: GameMemoryPayload;
  memoryError?: string;
  targetsError?: string;
  busy?: string;
  actionError?: string;
  /** 最近一次探针：问题与答复一起留着，免得答对不上问。 */
  probe?: { answer: GameProbeAnswer; question: string };
  probeError?: string;
};

/** 系统提示词导出清单页。 */
export type GamePromptsData = {
  slug: string;
  dir?: string;
  bundles?: GamePromptBundle[];
  bundlesError?: string;
};

/** 一份导出：整包读回，选中哪份由查询参数记。 */
export type GamePromptBundleData = {
  slug: string;
  id: string;
  bundle?: { createdAt: string; world: string; contentVersion: string; files: GamePromptFile[] };
  /** 选中的文件路径；没选就落在第一份。 */
  file?: string;
  bundleError?: string;
};

/** 一份故事原文。 */
export type GameStoryData = {
  slug: string;
  name: string;
  content?: string;
  path?: string;
  storyError?: string;
};

/**
 * 一次推进里的一步：链由几个回合串成，每一步各自一个作业。
 *
 * 后台要看的就是这一列——哪一步成了、哪一步败在哪，而不是「跑完了」一行。
 */
export type AdvanceStep = {
  label: string;
  jobId: string;
  status: string;
  detail?: string;
};

/** 局控制台的展示数据；动作与数据都由容器给，页面不碰网络。 */
export type GamePageData = {
  slug: string;
  busy?: string;
  actionError?: string;

  /** 最近一次推进的步骤（链或单步）：只留过程，不留结论。 */
  advanceSteps: AdvanceStep[];
  /** 推进回到界面时的一句话：停在哪、为什么停。 */
  advanceNote?: string;

  /** 世界图谱：舞台、actor 与当前顺位的上帝视角。 */
  graph?: GameGraph;
  graphError?: string;

  leaks?: unknown;
  leaksError?: string;
  /** 扫描结果进弹窗：按钮在顶部，报告不占主页面版面。 */
  leaksOpen: boolean;
};

export type GamePageActions = {
  refresh: () => Promise<void>;
  /**
   * 下一个：按游戏设计走一步（开顺位 / 补 world / 推一位角色与他的舞台 / 收工）。
   *
   * 后台只有这一个推进入口：不许指定推谁，也不许指定只推哪一层。
   */
  next: () => Promise<void>;
  endGame: (input: { outcome: string; message?: string }) => Promise<void>;
  deleteGame: () => Promise<void>;
  openLeaks: () => void;
  closeLeaks: () => void;
  rescanLeaks: () => void;
};

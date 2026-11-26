import type { GameSummary } from "../../features/games/useGames";
import type { NodeStatus } from "../../features/node/useNodeStatus";

/**
 * 总览页的三层读数：我在用谁看（身份）、看的是哪台机器（节点）、看到什么内容（局）。
 *
 * 轨迹读数不在这里：它是文件语料，与库脱钩，属于调试口径，单独一页。
 */
export type OverviewData = {
  identity?: { id: string; username: string; displayName: string; isAdmin: boolean };
  identityError?: string;
  node?: NodeStatus;
  nodeError?: string;
  /** 可达性与往返单独看 `health`：节点自述不需要每 5 秒重问一遍。 */
  health?: { latencyMs: number };
  healthError?: string;
  games?: GameSummary[];
  gamesError?: string;
  /** 连的服务端地址：这是配置，不是读数。 */
  apiBaseUrl: string;
};

export type OverviewHandlers = {
  onOpenGame: (gameRef: string) => void;
  onOpenTraces: () => void;
};

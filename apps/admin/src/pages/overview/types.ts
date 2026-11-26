import type { NodeStatus } from "../../features/node/useNodeStatus";

/** 总览只有两层：我在用谁看（身份）、看的是哪台机器（节点）。内容在各自的页面上。 */
export type OverviewData = {
  identity?: { id: string; username: string; displayName: string; isAdmin: boolean };
  identityError?: string;
  node?: NodeStatus;
  nodeError?: string;
  /** 可达性与往返单独看 `health`：节点自述不需要每 5 秒重问一遍。 */
  health?: { latencyMs: number };
  healthError?: string;
  /** 连的服务端地址：这是配置，不是读数。 */
  apiBaseUrl: string;
};

export type OverviewHandlers = {
  onOpenGames: () => void;
  onOpenTraces: () => void;
};

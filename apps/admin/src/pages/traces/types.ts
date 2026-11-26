import type { TraceEvent, TraceTurn } from "../../features/traces/traceIndex";
import type { TraceGameEntry } from "../../features/traces/useTraceFiles";

/**
 * 轨迹阅览器的三层，一层一屏：目录 → 回合 → 事件。
 *
 * 同一屏只放一层，是因为三样东西的读法不同：目录是找局，回合是找那一段，事件是逐行读。
 * 挤在一起时，任何一层都没有足够的宽度。
 */
export type TracesData = {
  /** 轨迹根目录：显示「读的是哪个文件夹」。 */
  dir?: string;
  games?: TraceGameEntry[];
  gamesError?: string;
};

export type TracesHandlers = {
  onOpenGame: (slug: string) => void;
  onBack: () => void;
};

/** 第二层：一个局的回合。 */
export type TraceTurnsData = {
  slug: string;
  games?: TraceGameEntry[];
  gamesError?: string;
  turns?: TraceTurn[];
  turnsError?: string;
};

export type TraceTurnsHandlers = {
  onOpenTurn: (turnId: string) => void;
  onBack: () => void;
};

/** 第三层：一个回合的原始事件。 */
export type TraceEventsData = {
  slug: string;
  turnId: string;
  turn?: TraceTurn;
  events?: TraceEvent[];
  eventsError?: string;
};

export type TraceEventsHandlers = {
  onBack: () => void;
};

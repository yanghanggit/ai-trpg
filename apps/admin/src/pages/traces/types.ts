import type { TraceStats, TraceTurn } from "../../features/traces/traceIndex";

/**
 * 轨迹读数页：文件语料的**调试口径**。
 *
 * 它有意不复用「局」的列表：两者数据源不同（文件 vs 数据库），硬拼成一张表会让人以为它们对得上账。
 */
export type TracesData = {
  stats?: TraceStats;
  statsError?: string;
  turns?: TraceTurn[];
  turnsError?: string;
  /**
   * 库里还存在的局。
   *
   * 轨迹会保留已删掉的局，这些 slug 点进去必然 404，所以页面只在集合里才做成可点的引用。
   */
  knownGameSlugs: ReadonlySet<string>;
};

export type TracesHandlers = {
  onOpenGame: (gameRef: string) => void;
  onBack: () => void;
};

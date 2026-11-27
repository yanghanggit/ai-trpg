import type { GameSummary } from "../../features/games/useGames";

/** 局列表页：库里那一层内容，单独一页看。 */
export type GamesData = {
  games?: GameSummary[];
  gamesError?: string;
};

export type GamesHandlers = {
  onOpenGame: (gameRef: string) => void;
  /** 「剧本」列的入口：看这一局的建局数据。 */
  onOpenBuild: (gameRef: string) => void;
  onRefresh: () => void;
};

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
  /** 真实删除：成功后重读列表；失败由弹窗自己说原因。 */
  onDelete: (gameRef: string) => Promise<void>;
  onRefresh: () => void;
};

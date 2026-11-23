/**
 * 局内页真正要用的字段。
 *
 * 它不是 `state` 的镜像：服务器多给什么，这里就不要什么。字段只随页面需要增长，
 * 由 `adaptGameState` 从 `state` 里取——服务端把 `state` 定型后，这一层会塌缩成恒等映射。
 */
export type GamePageData = {
  slug: string;
  name?: string;
  status?: string;
  version?: number;
  worldName?: string;
  contentKey?: string;
  /** 舞台名，按服务端给的顺序。 */
  stages: string[];
  messageCount: number;
};

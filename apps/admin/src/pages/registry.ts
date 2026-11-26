import type { ComponentType } from "react";
import GameRoute from "./game/GameRoute";
import OverviewContainer from "./overview/OverviewContainer";
import TracesContainer from "./traces/TracesContainer";

/**
 * 页面清单：后台的唯一路由表。
 *
 * 与 `apps/web` 的清单同形，但不接 mock 目录——后台没有 fixture 目录，
 * 它本身就以真数据为输入，另造一套假数据只会多一份要维护的对照。
 */
export type PageEntry = {
  key: string;
  path: string;
  title: string;
  Route: ComponentType;
};

export const pages: PageEntry[] = [
  { key: "overview", path: "/", title: "总览", Route: OverviewContainer },
  { key: "traces", path: "/traces", title: "轨迹", Route: TracesContainer },
  { key: "game", path: "/g/:slug", title: "局控制台", Route: GameRoute },
];

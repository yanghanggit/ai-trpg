import type { ComponentType } from "react";
import GameBuildRoute from "./game/GameBuildRoute";
import GameMessagesRoute from "./game/GameMessagesRoute";
import GameRoute from "./game/GameRoute";
import GameSnapshotRoute from "./game/GameSnapshotRoute";
import GameSnapshotsRoute from "./game/GameSnapshotsRoute";
import GameStoriesRoute from "./game/GameStoriesRoute";
import GameStoryRoute from "./game/GameStoryRoute";
import GamesContainer from "./games/GamesContainer";
import OverviewContainer from "./overview/OverviewContainer";
import TraceEventsContainer from "./traces/TraceEventsContainer";
import TracesContainer from "./traces/TracesContainer";
import TraceTurnsContainer from "./traces/TraceTurnsContainer";

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
  { key: "games", path: "/games", title: "局", Route: GamesContainer },
  { key: "traces", path: "/traces", title: "轨迹", Route: TracesContainer },
  { key: "trace-turns", path: "/traces/:game", title: "轨迹 · 回合", Route: TraceTurnsContainer },
  {
    key: "trace-events",
    path: "/traces/:game/:turn",
    title: "轨迹 · 事件",
    Route: TraceEventsContainer,
  },
  { key: "game", path: "/g/:slug", title: "局控制台", Route: GameRoute },
  { key: "game-build", path: "/g/:slug/build", title: "建局数据", Route: GameBuildRoute },
  {
    key: "game-messages",
    path: "/g/:slug/messages",
    title: "事件流",
    Route: GameMessagesRoute,
  },
  { key: "game-snapshots", path: "/g/:slug/snapshots", title: "快照", Route: GameSnapshotsRoute },
  {
    key: "game-snapshot",
    path: "/g/:slug/snapshots/:snapshot",
    title: "快照 · 内容",
    Route: GameSnapshotRoute,
  },
  { key: "game-stories", path: "/g/:slug/stories", title: "故事", Route: GameStoriesRoute },
  {
    key: "game-story",
    path: "/g/:slug/stories/:story",
    title: "故事 · 原文",
    Route: GameStoryRoute,
  },
];

import type { ComponentType } from "react";
import EntryContainer from "./entry/EntryContainer";
import GameRoute from "./game/GameRoute";

/**
 * 页面清单：正式路由与 mock 目录共用这一份。
 *
 * 加页面时同时登记 `key`（mock 深链接用）与 `path`，否则 mock 目录会与正式路由漂移。
 */
export type PageEntry = {
  key: string;
  path: string;
  title: string;
  Route: ComponentType;
};

export const pages: PageEntry[] = [
  { key: "entry", path: "/", title: "入口", Route: EntryContainer },
  { key: "game", path: "/g/:slug", title: "局内（占位）", Route: GameRoute },
];

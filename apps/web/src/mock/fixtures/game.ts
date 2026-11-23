import type { GamePageData } from "../../pages/game/types";

/** 局内页的可见状态；数值都取自真实内容包，方便对照。 */
export const gameFixtures = {
  active: {
    slug: "crow-run-1",
    name: "鸦葬岗的故事",
    status: "active",
    version: 19,
    worldName: "鸦葬岗的故事",
    contentKey: "crow-grave",
    stages: ["鸦葬岗", "守夜塔", "封尸窖"],
    messageCount: 42,
  },
  completed: {
    slug: "crow-http-1",
    name: "鸦葬岗的故事",
    status: "completed",
    version: 63,
    worldName: "鸦葬岗的故事",
    contentKey: "crow-grave",
    stages: ["鸦葬岗", "守夜塔", "封尸窖"],
    messageCount: 158,
  },
  empty: {
    slug: "mock-empty",
    stages: [],
    messageCount: 0,
  },
} satisfies Record<string, GamePageData>;

export type GameMockState = keyof typeof gameFixtures;

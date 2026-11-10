/**
 * 路线回忆：从 A 到 B 怎么走，结论写进 actor 自己的记忆。
 *
 * 回答始终是一条链，而不是「能不能到」的判定：能走通就写出整条路线；走不通就把链拉到
 * 断点、在断处标 `→[封着]→`。换一条路能到就照实给那一条。
 *
 * 装配与解析在 `build.ts`（两个入口共用 `routeWorldOf`），窄读在 `load.ts`，
 * 选路与断点在 `recall.ts`，文字在 `describe.ts`；遍历原语由 `stage-state/graph.ts` 提供。
 */

export { resolveRouteQuestion, routeWorldFromState } from "./build";
export { describeRoute, describeRouteFailure } from "./describe";
export { loadRouteWorld } from "./load";
export { findRoute } from "./recall";
export type { RouteQuestion, RouteResolution, RouteWorld } from "./types";

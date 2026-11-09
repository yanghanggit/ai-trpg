import assert from "node:assert/strict";
import { GameError } from "./errors";
import { isHandleRef } from "./reference";
import type { GameStateSlice, StageState } from "./types";

/**
 * 场景的状态层定位：把引用解析成 `StageState`。
 *
 * 与行级读写（`persistence/stages.ts`）分开：这里只看已装载的状态，不碰数据库。
 *
 * 两个入口，用哪种取决于「谁在指认」：
 * - 控制面（玩家入口、开发期命令、内部调用）用 `findStage`，id 与真名都认；
 * - actor-facing 用 `resolveStageName`，只认真名——`#序号` 表示「看得见但还没命名」，
 *   一旦允许它当地名，路过的站位就会倒过来变成地名知识。
 */

/**
 * 按场景真名定位：`#序号` 与 id 一律不算名字。
 *
 * 「能指名」是种权利而不是便利，所以解析失败不抛错，而是把原因交给调用方回话：
 * 问路要把「认不出这个名字」当成一次回忆的结论，而不是一次异常。
 */
export type StageNameResolution =
  | { ok: true; stage: StageState }
  | { ok: false; reason: "empty" | "handle_ref" | "unknown_stage" | "ambiguous" };

export function resolveStageName(state: GameStateSlice, ref: string): StageNameResolution {
  const name = ref.trim();
  if (name.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (isHandleRef(name)) {
    return { ok: false, reason: "handle_ref" };
  }
  const matches = state.world.stages.filter((stage) => stage.name === name);
  if (matches.length === 0) {
    return { ok: false, reason: "unknown_stage" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }
  const [match] = matches;
  assert(match, `场景定位结果为空: ${name}`);
  return { ok: true, stage: match };
}

/** 控制面定位：id 或真名都接受；名字重复时提示改用 id。 */
export function findStage(state: GameStateSlice, ref: string): StageState {
  const matches = state.world.stages.filter((stage) => stage.id === ref || stage.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `场景不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `场景名称不唯一，请使用 id: ${ref}`);
  }
  const [match] = matches;
  assert(match, `场景定位结果为空: ${ref}`);
  return match;
}

/** 名字精确匹配；查不到返回 undefined，供「可能没有这个场景」的只读用途。 */
export function findStageByName(state: GameStateSlice, name: string): StageState | undefined {
  return state.world.stages.find((stage) => stage.name === name);
}

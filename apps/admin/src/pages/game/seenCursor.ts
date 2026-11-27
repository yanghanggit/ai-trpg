/**
 * 「我看到第几条了」——只记在这个浏览器里。
 *
 * 它是**阅读水位**，不是这一局的数据：换台机器、清掉缓存，就从头看起。放本地而不是
 * 服务端，是因为它只回答「我上次看到哪」，不回答「这一局发生了什么」。
 */

import { readNumberPref, writeNumberPref } from "../../lib/localPrefs";

const PREFIX = "ai-trpg.admin.seen:";

function keyOf(slug: string): string {
  return `${PREFIX}${slug}`;
}

/** 上次看到的最大序号；没看过（或读不到本地存储）就是 `undefined`。 */
export function readSeenCursor(slug: string): number | undefined {
  return readNumberPref(keyOf(slug));
}

export function writeSeenCursor(slug: string, cursor: number): void {
  writeNumberPref(keyOf(slug), cursor);
}

/**
 * 水位之后还有几条没看：事件流的序号是连续递增的，所以相减就是条数。
 *
 * 水位缺失（第一次）或超过当前位置（换局、重置过）时算 0——不报错，也不编一个数出来。
 */
export function unseenCount(cursor: number | undefined, seen: number | undefined): number {
  if (cursor === undefined || seen === undefined) {
    return 0;
  }
  return Math.max(0, cursor - seen);
}

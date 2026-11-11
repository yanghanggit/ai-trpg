/**
 * 地址的字符串语法：观察者当前的称呼（纯名字），或占位编号 `#12`。
 *
 * `#` 是引擎唯一保留的前缀——它既要能写、能读、能在句子里扫出来，又必须在世界面被拦下。
 * 这些特化处理集中在这里：散在各处各写一份正则，放宽一处就会在另一处漏网。
 *
 * 模块最底层：只认字符，不认识任何人。上面两层是观察者相对的投影（`projection.ts`）
 * 与世界面守卫（`guard.ts`）。
 */

import { GameError } from "../../errors";

/** 名字里不能出现地址标记 `#`：它既是保留前缀，也是句子里能被扫出来的编号。 */
export const NAME_MARKER_PATTERN = /#/;

/** 编号的书写形式；序号由本局实体序号分配。 */
export function handleOf(seq: number): string {
  return `#${seq}`;
}

/** 编号在句子里的形态；不带 `g`，遍历用 `handlesIn`，拼接正则用 `.source`。 */
export const HANDLE_PATTERN = /#\d+/;

/** 严格的编号写法：`#12`，序号是正整数。 */
const HANDLE_EXACT_PATTERN = /^#([1-9]\d*)$/;

/** 这个参数是不是被写成了编号（不保证编号合法）。 */
export function isHandleRef(ref: string): boolean {
  return ref.startsWith("#");
}

/** 解析编号；不是 `#正整数` 时返回 null。 */
export function parseHandle(ref: string): number | null {
  const match = HANDLE_EXACT_PATTERN.exec(ref);
  return match ? Number(match[1]) : null;
}

/** 句子里出现的全部编号，按出现顺序去重。 */
export function handlesIn(text: string): string[] {
  return [...new Set(text.match(HANDLE_PATTERN) ?? [])];
}

/** 世界面守卫用：文本里是否出现了编号。 */
export function containsHandle(text: string): boolean {
  return HANDLE_PATTERN.test(text);
}

/**
 * 一个名字能不能写进地址表：不能为空，不能含 `#`，不能含控制字符。
 *
 * 模型工具与玩家入口共用这一份；两个入口各写一次规则，放宽一处就会在另一处漏网。
 */
export function parseSignatureName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0) {
    throw new GameError("invalid_action", "name 不能为空");
  }
  if (NAME_MARKER_PATTERN.test(name) || /\p{Cc}/u.test(name)) {
    throw new GameError("invalid_action", "name 不能包含 # 或控制字符");
  }
  return name;
}

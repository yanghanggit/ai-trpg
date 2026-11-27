/**
 * 这个浏览器里的读数偏好：「看到第几条」「事件流怎么排」。
 *
 * 它们不回答「这一局发生了什么」，只回答「我习惯怎么看」，所以放本地、不发请求。
 * 隐私模式下 localStorage 会抛异常——读不到就当没设过，不能让偏好把整页搞挂。
 */

function read(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 记不住就退化成「每次都按默认」，不影响读。
  }
}

/** 原样读一个字符串偏好；没设过（或读不到）就是 `undefined`。 */
export function readPref(key: string): string | undefined {
  return read(key);
}

export function writePref(key: string, value: string): void {
  write(key, value);
}

/** 数字偏好：解析不出数字就当没设过。 */
export function readNumberPref(key: string): number | undefined {
  const raw = read(key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export function writeNumberPref(key: string, value: number): void {
  write(key, String(value));
}

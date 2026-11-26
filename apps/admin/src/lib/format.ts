/** 后台展示用的小格式化：只做时区与可读性，不参与任何判断。 */

/** ISO 时间戳 → 本地「MM-DD HH:mm:ss」；解析失败时原样返回。 */
export function formatAt(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length === 0) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

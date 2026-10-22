/** 把秒数格式化成适合展示的「X 小时 Y 分 / X 分 Y 秒」。 */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${restSeconds} 秒`;
  }
  return `${restSeconds} 秒`;
}

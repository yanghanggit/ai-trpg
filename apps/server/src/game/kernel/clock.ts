/**
 * 逻辑时刻的渲染：这是回合制游戏的「时间」，不是墙钟时间。
 *
 * 只做文本，不读库：时刻的值归游戏聚合，三个回合的提示词各自取到再交给这里。
 * 规划读到的世界在 `clock`，这一回合落账后进入 `clock + 1`；记忆里的每条事实写的是后者。
 */
export function renderTurnClock(clock: number): string {
  return `现在：第 ${clock} 刻
本回合落账后：第 ${clock + 1} 刻`;
}

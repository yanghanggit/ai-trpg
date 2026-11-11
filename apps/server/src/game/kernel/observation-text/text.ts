import { type Address, appearanceLine } from "../addressing";

/**
 * 观察文本的公共拼装：句子只留编号或当前名字，外观另起一行。
 *
 * 外观对认知隔离是必要的（名字可能错或撞，只能靠样子辅助辨认），但它不是名字，
 * 不能塞进句子；所以它统一追加在结尾，并去重。
 */

/**
 * 观察末尾把外观另起一行：句子只留编号或当前名字，外观不冒充名字。
 *
 * 外观对认知隔离是必要的（名字可能错或撞，只能靠样子辅助辨认），但它不是名字，不能塞进句子。
 */
export function withAppearances(content: string, addresses: readonly Address[]): string {
  const lines = addresses
    .map((address) => appearanceLine(address))
    .filter((line): line is string => line !== null);
  const unique = [...new Set(lines)];
  return unique.length === 0
    ? content
    : `${content}

${unique.join("\n")}`;
}

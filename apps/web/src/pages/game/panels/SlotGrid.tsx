import type { ReactNode } from "react";

/** 一行四格。 */
const PER_ROW = 4;

/** 至少两排：条目少时浮窗仍是一个稳定的面，不会缩成一条。 */
const MIN_SLOTS = PER_ROW * 2;

/**
 * 卡片网格：背包、行迹、相识共用这一套。
 *
 * 空格不是占位符而是排版的一部分：条目数量随时会变，网格的行数与浮窗面积不能跟着跳。
 * 传进来的 `children` 必须是一组 `<li>`，网格只管补格与补空。
 */
export default function SlotGrid({ children }: { children: ReactNode[] }) {
  const slots = Math.max(MIN_SLOTS, Math.ceil(children.length / PER_ROW) * PER_ROW);

  return (
    <ul className="slots">
      {children}
      {emptySlots(slots - children.length).map((label) => (
        // 空格子只是版面：没有条目、没有交互，读屏也不念它。
        <li key={label} aria-hidden="true">
          <div className="slot slot--empty" />
        </li>
      ))}
    </ul>
  );
}

/** 空格子不按数组下标取值，否则重排时 React 会把它们当成有身份的东西。 */
function emptySlots(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `empty-slot-${index + 1}`);
}

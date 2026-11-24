import type { GameView } from "../../../features/games/useGameView";

type Item = GameView["viewer"]["items"][number];

/** 一行四格；不足的空格补齐，让每排都完整。 */
const PER_ROW = 4;

/** 至少两排：道具少时浮窗仍是一个稳定的面，不会缩成一条。 */
const MIN_SLOTS = PER_ROW * 2;

/** 空格子不按数组下标取值，否则重排时 React 会把它们当成有身份的东西。 */
function emptySlots(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `empty-slot-${index + 1}`);
}

/**
 * 「inventory」：身上带着的东西。四列卡片，竖向滚动。
 *
 * 空格不是占位符而是排版的一部分：道具数量随时会变，网格的行数与浮窗面积不能跟着跳。
 */
export default function InventoryPanel({ items }: { items: Item[] }) {
  const slots = Math.max(MIN_SLOTS, Math.ceil(items.length / PER_ROW) * PER_ROW);

  return (
    <>
      <ul className="slots">
        {items.map((item) => (
          <li key={item.name}>
            <div className="slot">
              <span className="slot__kind">{item.kindLabel}</span>
              <span className="slot__name">{item.name}</span>
              <span className="slot__note">{item.description}</span>
            </div>
          </li>
        ))}

        {emptySlots(slots - items.length).map((label) => (
          // 空格子只是版面：没有道具、没有交互，读屏也不念它。
          <li key={label} aria-hidden="true">
            <div className="slot slot--empty" />
          </li>
        ))}
      </ul>
    </>
  );
}

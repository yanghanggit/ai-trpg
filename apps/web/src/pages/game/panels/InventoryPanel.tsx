import type { GameView } from "../../../features/games/useGameView";
import SlotGrid from "./SlotGrid";

type Item = GameView["viewer"]["items"][number];

/** 「背包」：身上带着的东西。四列卡片，竖向滚动。 */
export default function InventoryPanel({ items }: { items: Item[] }) {
  return (
    <SlotGrid>
      {items.map((item) => (
        <li key={item.name}>
          <div className="slot">
            <span className="slot__kind">{item.kindLabel}</span>
            <span className="slot__name">{item.name}</span>
            <span className="slot__note">{item.description}</span>
          </div>
        </li>
      ))}
    </SlotGrid>
  );
}

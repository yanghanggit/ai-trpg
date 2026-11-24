import type { GameView } from "../../../features/games/useGameView";
import SlotGrid from "./SlotGrid";

type Anchor = GameView["stage"]["anchors"][number];

/**
 * 「锚点」浮窗：上面放着什么。
 *
 * 锚点本身的描写在主页那张卡上（那里已经写了一句），所以这里只剩道具。
 * 道具与背包同一种卡片：同一件东西在哪个浮窗里都是卡片，读者不用重新认一遍。
 * 点下去只打日志——捡起、查看都要过动作提交（判敏捷、留痕迹），等动作入口接上再连。
 */
export default function AnchorPanel({ anchor }: { anchor: Anchor }) {
  if (anchor.items.length === 0) {
    return <p className="muted">上面没东西。</p>;
  }

  return (
    <SlotGrid>
      {anchor.items.map((item) => (
        <li key={item.name}>
          <button
            type="button"
            className="slot slot--action"
            onClick={() => console.log("道具", anchor.label, item.name)}
          >
            <span className="slot__kind">{item.kindLabel}</span>
            <span className="slot__name">{item.name}</span>
            <span className="slot__note">{item.description}</span>
          </button>
        </li>
      ))}
    </SlotGrid>
  );
}

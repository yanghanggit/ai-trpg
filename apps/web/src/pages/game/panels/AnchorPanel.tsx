import type { GameView } from "../../../features/games/useGameView";

type Anchor = GameView["stage"]["anchors"][number];

/**
 * 「锚点」浮窗：这里是什么、上面放着什么。
 *
 * 陈列的道具排成竖向列表，每条都可点；现在点下去只打日志——
 * 捡起、查看都要过动作提交（判敏捷、留痕迹），等动作入口接上再连。
 */
export default function AnchorPanel({ anchor }: { anchor: Anchor }) {
  return (
    <>
      {anchor.description === undefined ? null : <p className="prose">{anchor.description}</p>}

      {anchor.items.length === 0 ? (
        <p className="muted">上面没东西。</p>
      ) : (
        <ul className="stack">
          {anchor.items.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                className="stack__item"
                onClick={() => console.log("道具", anchor.label, item.name)}
              >
                <span className="stack__name">{item.name}</span>
                {item.description.length === 0 ? null : (
                  <span className="stack__note">{item.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

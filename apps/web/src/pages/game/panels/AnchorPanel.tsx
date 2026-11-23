import type { GameView } from "../../../features/games/useGameView";

type Anchor = GameView["stage"]["anchors"][number];

/** 「锚点」浮窗：这里是什么、上面放着什么。 */
export default function AnchorPanel({ anchor }: { anchor: Anchor }) {
  return (
    <>
      {anchor.description === undefined ? null : <p className="prose">{anchor.description}</p>}

      <h3>上面放着</h3>
      {anchor.items.length === 0 ? (
        <p className="muted">空的。</p>
      ) : (
        <ul className="entries">
          {anchor.items.map((item) => (
            <li key={item.name}>
              <strong>{item.name}</strong>
              {item.description.length === 0 ? null : (
                <span className="entries__note">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

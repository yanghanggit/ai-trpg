import type { QueueRow } from "./types";

type Props = {
  rows: QueueRow[];
  onSelect: (actorId: string) => void;
};

/**
 * 顺位条：这一局此刻的排队顺序。
 *
 * 它不进画布——名次是线性读法，摊进图里既挤又看不出先后。点一行直接落到那个 actor。
 */
export default function QueueStrip({ rows, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="muted">没有进行中的顺位。要排队，先在下面的「推进」里开一条。</p>;
  }

  return (
    <ol className="queue">
      {rows.map((row) => (
        <li
          key={row.actorId}
          className={row.isNext ? "queue__item queue__item--next" : "queue__item"}
        >
          <button type="button" className="queue__row" onClick={() => onSelect(row.actorId)}>
            <span className="queue__pos">{row.position}</span>
            <span className={row.alive ? "queue__name" : "queue__name queue__name--dead"}>
              {row.name}
            </span>
            <span className="queue__meta">
              {row.control === "player" ? "玩家" : "NPC"} · {row.turnsTaken} 回合
            </span>
            {row.isNext ? <span className="badge badge--ok">轮到</span> : null}
            {row.alive ? null : <span className="badge badge--error">已死</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

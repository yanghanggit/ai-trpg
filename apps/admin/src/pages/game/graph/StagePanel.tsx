import type { GameGraph } from "../../../features/games/useGameGraph";
import type { StageView } from "./types";

type Props = {
  graph: GameGraph;
  view: StageView;
  onItemClick: (item: Record<string, unknown>) => void;
  onSelectStage: (stageId: string) => void;
};

/**
 * 第二层没选人时的面板：这个舞台本身。
 *
 * 锚点与挂在上面的道具在这里，而不是画进图里——道具是「舞台里能操作的东西」，
 * 摊成节点会让一屏变成几十个点。点道具仍然开弹窗看原文。
 */
export default function StagePanel({ graph, view, onItemClick, onSelectStage }: Props) {
  const { stage, neighbours } = view;
  const people = graph.actors.filter((actor) => actor.stageId === stage.id);

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h3>{stage.name}</h3>
        <p className="muted">
          <code>#{stage.seq}</code> · <code>{stage.key}</code> · ordinal {stage.ordinal}
          {stage.teleportBlocked ? " · 禁传送" : ""}
        </p>
      </header>

      <h4>环境</h4>
      <p className="inspector__text">{stage.environment || "—"}</p>

      <h4>在场</h4>
      {people.length === 0 ? (
        <p className="muted">这里没有人。</p>
      ) : (
        <p className="inspector__chips">
          {people.map((actor) => (
            <span key={actor.id} className="badge">
              {actor.name}
            </span>
          ))}
        </p>
      )}

      <h4>出口</h4>
      {neighbours.length === 0 ? (
        <p className="muted">没有连通的舞台。</p>
      ) : (
        <ul className="inspector__list">
          {neighbours.map((neighbour) => (
            <li key={`${neighbour.direction}:${neighbour.stage.id}`}>
              <button
                type="button"
                className="linkish"
                onClick={() => onSelectStage(neighbour.stage.id)}
              >
                {neighbour.stage.name}
              </button>
              <span className="muted">
                {neighbour.direction === "out" ? "从这里去" : "从那边来"} ·{" "}
                {neighbour.passage === "sealed" ? "封锁" : "可通行"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h4>锚点</h4>
      {stage.anchors.length === 0 ? (
        <p className="muted">这个舞台没有可交互锚点。</p>
      ) : (
        <ul className="inspector__list">
          {stage.anchors.map((anchor) => (
            <li key={anchor.key}>
              <strong>{anchor.label}</strong>
              {anchor.description === undefined ? null : (
                <span className="muted">{anchor.description}</span>
              )}
              {anchor.items.length === 0 ? null : (
                <ul className="inspector__sublist">
                  {anchor.items.map((item) => (
                    <li
                      key={`${anchor.key}:${typeof item.id === "string" ? item.id : String(item.name)}`}
                    >
                      <button type="button" className="linkish" onClick={() => onItemClick(item)}>
                        {typeof item.name === "string" ? item.name : "(无名)"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <h4>可用动作</h4>
      <p className="inspector__chips">
        {stage.actions.map((action) => (
          <span key={action} className="badge">
            {action}
          </span>
        ))}
      </p>
    </aside>
  );
}

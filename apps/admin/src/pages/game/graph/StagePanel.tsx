import Hint from "../../../components/Hint";
import type { GameGraph } from "../../../features/games/useGameGraph";
import type { StageExit, StageView } from "./types";
import { describePassage } from "./viewModel";

type Passage = "open" | "sealed" | null;

/**
 * 两个方向画成一条线的两半：左半边指向本舞台（从对面来），右半边指向对面（从这里去）。
 *
 * 一个方向一个状态，各自上色与线段样式：实线 accent = 能走，虚线灰 = 封着，
 * 整半边不画 = 那个方向根本没有通路。所以一支箭头的单向通路自己就长成单向的样子。
 */
function PassageGlyph({ exit }: { exit: StageExit }) {
  const half = (passage: Passage, side: "in" | "out") => {
    if (passage === null) {
      return null;
    }
    const sealed = passage === "sealed";
    return (
      <g className={sealed ? "passage__half passage__half--sealed" : "passage__half"}>
        {side === "in" ? (
          <>
            <line x1="3" y1="7" x2="24" y2="7" />
            <path d="M10 2.5 L3 7 L10 11.5" />
          </>
        ) : (
          <>
            <line x1="32" y1="7" x2="53" y2="7" />
            <path d="M46 2.5 L53 7 L46 11.5" />
          </>
        )}
      </g>
    );
  };

  return (
    <svg className="passage" viewBox="0 0 56 14" width="56" height="14" role="img">
      <title>{describePassage(exit)}</title>
      {half(exit.in, "in")}
      {half(exit.out, "out")}
    </svg>
  );
}

/**
 * 一条出口写成一条关系式：本舞台 ⇄ 对面那个。
 *
 * 两边的名字让箭头不必解释方向——左边那支指向本舞台，右边那支指向对面；
 * 只有右边名字是链接，左边是本舞台自己，点了没有意义。
 */
function ExitRow({
  exit,
  here,
  onSelect,
}: {
  exit: StageExit;
  here: string;
  onSelect: () => void;
}) {
  return (
    <li className="exit__row">
      <span className="exit__here">{here}</span>
      <PassageGlyph exit={exit} />
      <button type="button" className="linkish exit__other" onClick={onSelect}>
        {exit.stage.name}
      </button>
    </li>
  );
}

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

      <h4>
        出口
        <Hint text="一行一条通路：左边是本舞台，右边是对面那个。两个方向各占半条线，左边那支指向这里、右边那支指向对面；实线=能走，虚线灰=封着，缺一半=那个方向没有通路。点右边名字跳过去。" />
      </h4>
      {neighbours.length === 0 ? (
        <p className="muted">没有连通的舞台。</p>
      ) : (
        <ul className="inspector__list exit">
          {neighbours.map((exit) => (
            <ExitRow
              key={exit.stage.id}
              exit={exit}
              here={stage.name}
              onSelect={() => onSelectStage(exit.stage.id)}
            />
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

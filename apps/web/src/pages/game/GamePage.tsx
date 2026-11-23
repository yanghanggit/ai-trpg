import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { GameView } from "../../features/games/useGameView";
import Dialog from "./Dialog";
import MePanel from "./panels/MePanel";
import VisitedPanel from "./panels/VisitedPanel";

type Panel = "me" | "visited" | "history";

type GamePageProps = {
  view: GameView;
  /**
   * 消息历史的内容由外层注入：页面不取数，mock 因此也能打开同一个浮窗。
   * 回调里要带上 `onClose`，关闭动作由页面自己管。
   */
  renderHistory: (args: { slug: string; onClose: () => void }) => ReactNode;
};

/**
 * 局内页：只吃观看者投影，不发请求。
 *
 * 主页只留「此刻发生了什么」——当前舞台与感知日志；「我」「去过」「消息历史」这类
 * 需要时才看的东西挂在顶部按钮上，点开是浮窗，不占主线的注意力。
 */
export default function GamePage({ view, renderHistory }: GamePageProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const { game, viewer, stage, log } = view;
  const close = () => setPanel(null);

  return (
    <main className="launch">
      <div className="launch__inner">
        <nav className="toolbar" aria-label="局内快捷入口">
          <span className="toolbar__label">{game.name}</span>
          <div className="toolbar__buttons">
            <button type="button" className="button button--ghost" onClick={() => setPanel("me")}>
              我
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setPanel("visited")}
            >
              去过
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setPanel("history")}
            >
              消息历史
            </button>
          </div>
        </nav>

        <header className="launch__header">
          <p className="launch__eyebrow">
            <Link to="/">← 入口</Link>
          </p>
          <h1>{game.name}</h1>
          <p className="launch__lead">
            <code>{game.slug}</code> · {game.status} · v{game.version}
          </p>
        </header>

        <section className="panel">
          <h2>{stage.name}</h2>
          <p className="muted">{stage.environment}</p>

          {stage.anchors.length > 0 ? (
            <ul className="entries">
              {stage.anchors.map((anchor) => (
                <li key={anchor.key}>
                  <strong>{anchor.label}</strong>
                  {anchor.description === undefined ? null : (
                    <span className="entries__note">{anchor.description}</span>
                  )}
                  {anchor.items.length > 0 ? (
                    <span className="entries__note">
                      {anchor.items.map((item) => item.name).join("、")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">这里没有可作用的地方。</p>
          )}

          <h3>在场</h3>
          {stage.actors.length > 0 ? (
            <ul className="chips">
              {stage.actors.map((actor) => (
                <li key={actor.actorId} className={actor.alive ? "chip" : "chip chip--faded"}>
                  {actor.label}
                  {actor.self ? "（我）" : ""}
                  {actor.alive ? "" : "（已死）"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">只有我一个人。</p>
          )}

          <h3>出口</h3>
          {stage.exits.length > 0 ? (
            <ul className="chips">
              {stage.exits.map((exit) => (
                <li key={exit.stageId} className="chip">
                  {exit.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">没有通着的出口。</p>
          )}
          {stage.sealedExits.length > 0 ? (
            <p className="muted">
              封着：
              {stage.sealedExits.map((exit) => exit.name).join("、")}
            </p>
          ) : null}
        </section>

        <section className="panel">
          <h2>感知日志</h2>
          {log.length > 0 ? (
            <ol className="entries">
              {log.map((entry) => (
                <li key={`${entry.sequence}-${entry.kind}`}>
                  <span className="entries__kind">{entry.kind}</span>
                  {entry.content}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">{viewer.name}还没有感知到任何事。</p>
          )}
        </section>

        {panel === "me" ? (
          <Dialog title="我" onClose={close}>
            <MePanel view={view} />
          </Dialog>
        ) : null}

        {panel === "visited" ? (
          <Dialog title="去过" onClose={close}>
            <VisitedPanel view={view} />
          </Dialog>
        ) : null}

        {panel === "history" ? renderHistory({ slug: game.slug, onClose: close }) : null}
      </div>
    </main>
  );
}

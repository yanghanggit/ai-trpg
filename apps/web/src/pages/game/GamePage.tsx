import { type ReactNode, useState } from "react";
import type { GameView } from "../../features/games/useGameView";
import Dialog from "./Dialog";
import KnowPanel from "./panels/KnowPanel";
import MePanel from "./panels/MePanel";

type Panel = "me" | "know" | "history";

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
 * 桌面横屏是唯一目标：顶部一条按钮带，下面是当前舞台的三栏版面。
 * 局名、slug 与角色明细都在「我」里——主页只回答「此刻我在哪、这里有什么」。
 * 也没有「返回上一级」：游戏里没有上一级，回入口是开发期的导航，不属于这一页。
 */
export default function GamePage({ view, renderHistory }: GamePageProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const { stage } = view;
  const close = () => setPanel(null);

  return (
    <main className="game">
      <nav className="game__bar">
        <div className="game__actions">
          <button type="button" className="action" onClick={() => setPanel("me")}>
            我
          </button>
          <button type="button" className="action" onClick={() => setPanel("know")}>
            认得
          </button>
          <button type="button" className="action" onClick={() => setPanel("history")}>
            消息历史
          </button>
        </div>
      </nav>

      <section className="stage">
        <header className="stage__header">
          <h1>{stage.name}</h1>
          <p className="stage__environment">{stage.environment}</p>
        </header>

        <div className="stage__columns">
          <section className="column column--wide">
            <h2>锚点</h2>
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
          </section>

          <section className="column">
            <h2>在场</h2>
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
          </section>

          <section className="column">
            <h2>出口</h2>
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
        </div>
      </section>

      {panel === "me" ? (
        <Dialog title="我" onClose={close}>
          <MePanel view={view} />
        </Dialog>
      ) : null}

      {panel === "know" ? (
        <Dialog title="认得" onClose={close}>
          <KnowPanel view={view} />
        </Dialog>
      ) : null}

      {panel === "history" ? renderHistory({ slug: view.game.slug, onClose: close }) : null}
    </main>
  );
}

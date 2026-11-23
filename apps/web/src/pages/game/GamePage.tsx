import { type ReactNode, useState } from "react";
import type { GameView } from "../../features/games/useGameView";
import Dialog from "./Dialog";
import ActorPanel from "./panels/ActorPanel";
import AnchorPanel from "./panels/AnchorPanel";
import ExitPanel from "./panels/ExitPanel";
import KnowPanel from "./panels/KnowPanel";
import MePanel from "./panels/MePanel";
import StagePanel from "./panels/StagePanel";

/** 打开的是哪一张浮窗。卡片与顶部按钮共用这一个状态。 */
type Sheet =
  | { kind: "me" }
  | { kind: "know" }
  | { kind: "history" }
  | { kind: "stage" }
  | { kind: "anchor"; anchor: GameView["stage"]["anchors"][number] }
  | { kind: "exit"; exit: { name: string; ref: string | null; sealed: boolean } }
  | { kind: "actor"; actor: GameView["stage"]["actors"][number] };

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
 * 主页是三排卡片：舞台与它的锚点、在场角色、出口。卡片只放名字与一句提示，
 * 描写类文本（环境、外观）都在浮窗里——那是给模型读的上下文，不是主页要铺的东西。
 */
export default function GamePage({ view, renderHistory }: GamePageProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const { stage } = view;
  const close = () => setSheet(null);

  return (
    <main className="game">
      <nav className="game__bar">
        <div className="game__actions">
          <button type="button" className="action" onClick={() => setSheet({ kind: "me" })}>
            我
          </button>
          <button type="button" className="action" onClick={() => setSheet({ kind: "know" })}>
            认得
          </button>
          <button type="button" className="action" onClick={() => setSheet({ kind: "history" })}>
            消息历史
          </button>
        </div>
      </nav>

      <section className="board" aria-label="当前舞台">
        <ul className="board__row">
          <li>
            <button type="button" className="card" onClick={() => setSheet({ kind: "stage" })}>
              <span className="card__kind">舞台</span>
              <span className="card__title">{stage.name}</span>
              <span className="card__hint">
                锚点 {stage.anchors.length} · 出口 {stage.exits.length + stage.sealedExits.length}
              </span>
            </button>
          </li>

          {stage.anchors.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="card"
                onClick={() => setSheet({ kind: "anchor", anchor: item })}
              >
                <span className="card__kind">锚点</span>
                <span className="card__title">{item.label}</span>
                <span className="card__hint">
                  {item.items.length === 0 ? "空的" : item.items.map((i) => i.name).join("、")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <ul className="board__row">
          {stage.actors.map((item) => (
            <li key={item.actorId}>
              <button
                type="button"
                className={item.alive ? "card" : "card card--faded"}
                onClick={() =>
                  item.self ? setSheet({ kind: "me" }) : setSheet({ kind: "actor", actor: item })
                }
              >
                <span className="card__kind">{item.self ? "我" : "角色"}</span>
                <span className="card__title">{item.name}</span>
                <span className="card__hint">
                  <code>{item.token}</code>
                  {item.alive ? "" : " · 已死"}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <ul className="board__row">
          {stage.exits.map((item) => (
            <li key={item.stageId}>
              <button
                type="button"
                className="card"
                onClick={() =>
                  setSheet({
                    kind: "exit",
                    exit: { name: item.name, ref: item.ref, sealed: false },
                  })
                }
              >
                <span className="card__kind">出口</span>
                <span className="card__title">{item.name}</span>
                <span className="card__hint">通着</span>
              </button>
            </li>
          ))}

          {stage.sealedExits.map((item) => (
            <li key={`sealed-${item.stageId}`}>
              <button
                type="button"
                className="card card--faded"
                onClick={() =>
                  setSheet({ kind: "exit", exit: { name: item.name, ref: null, sealed: true } })
                }
              >
                <span className="card__kind">出口</span>
                <span className="card__title">{item.name}</span>
                <span className="card__hint">封着</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {sheet?.kind === "me" ? (
        <Dialog title="我" onClose={close}>
          <MePanel view={view} />
        </Dialog>
      ) : null}

      {sheet?.kind === "know" ? (
        <Dialog title="认得" onClose={close}>
          <KnowPanel view={view} />
        </Dialog>
      ) : null}

      {sheet?.kind === "stage" ? (
        <Dialog title={stage.name} onClose={close}>
          <StagePanel view={view} />
        </Dialog>
      ) : null}

      {sheet?.kind === "anchor" ? (
        <Dialog title={sheet.anchor.label} onClose={close}>
          <AnchorPanel anchor={sheet.anchor} />
        </Dialog>
      ) : null}

      {sheet?.kind === "exit" ? (
        <Dialog title={sheet.exit.name} onClose={close}>
          <ExitPanel exit={sheet.exit} />
        </Dialog>
      ) : null}

      {sheet?.kind === "actor" ? (
        <Dialog title={sheet.actor.name} onClose={close}>
          <ActorPanel actor={sheet.actor} />
        </Dialog>
      ) : null}

      {sheet?.kind === "history" ? renderHistory({ slug: view.game.slug, onClose: close }) : null}
    </main>
  );
}

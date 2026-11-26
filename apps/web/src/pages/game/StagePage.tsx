import { type ReactNode, useState } from "react";
import type { GameView } from "../../features/games/useGameView";
import Dialog from "./Dialog";
import ActorPanel from "./panels/ActorPanel";
import AnchorPanel from "./panels/AnchorPanel";
import InventoryPanel from "./panels/InventoryPanel";
import MePanel from "./panels/MePanel";
import PeoplePanel from "./panels/PeoplePanel";
import PlacesPanel from "./panels/PlacesPanel";
import StagePanel from "./panels/StagePanel";

/**
 * 打开的是哪一张浮窗。卡片与顶部按钮共用这一个状态。
 *
 * 浮窗是个栈：本人里点 inventory 会在它上面再开一层，关掉这一层退回去。
 */
type Sheet =
  | { kind: "me" }
  | { kind: "inventory" }
  | { kind: "people" }
  | { kind: "places" }
  | { kind: "act" }
  | { kind: "history" }
  | { kind: "stage" }
  | { kind: "anchor"; anchor: GameView["stage"]["anchors"][number] }
  | { kind: "actor"; actor: GameView["stage"]["actors"][number] };

type StagePageProps = {
  view: GameView;
  /**
   * 「记录」的内容由外层注入：页面不取数，mock 因此也能打开同一个浮窗。
   * 回调里要带上 `onClose`，关闭动作由页面自己管。
   */
  renderHistory: (args: { slug: string; onClose: () => void }) => ReactNode;
  /**
   * 「动作」浮窗也由外层注入：它要连服务端、要写状态，页面只负责开与关。
   * mock 传一个假实现，同一个按钮在目录里就能点开。
   */
  renderTurn: (args: { slug: string; onClose: () => void }) => ReactNode;
  /** 顶上的一条提示（例如「这一局有回合在跑」）；内容由外层决定，页面只留位置。 */
  notice?: ReactNode;
};

/** 头像上的字：本名的第一个字（引号、括号里的部分不算）。 */
function initialOf(name: string): string {
  const plain = name.split(/[（(“"]/)[0]?.trim() ?? "";
  return plain.slice(0, 1) || "?";
}

/**
 * 舞台页：一位观看者此刻所见的这一个舞台。只吃观看者投影，不取数、不读路由。
 *
 * 名字里的「舞台」就是契约里的 `ActorView.stage`：这一页回答「我在哪、看得见什么」，
 * 不是「这一局」的全部界面——配置、回放之类的局级页面将来是它的兄弟，不归它管。
 *
 * 页面分两段：顶部四颗按钮是围绕此刻的四个抽屉（本人／相识／行迹／记录），
 * 核心区是两排卡片：舞台与它的锚点、在场角色。出口不占卡片——它写在舞台卡上（`出口 2`），
 * 打开舞台浮窗才列成按钮：从哪扇门出去属于「这个舞台」，不属于「我此刻看得见的东西」。卡片只放名字与一句提示，
 * 描写类文本（环境、外观）都在浮窗里——那是给模型读的上下文，不是主页要铺的东西。
 */
export default function StagePage({ view, renderHistory, renderTurn, notice }: StagePageProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const { stage, viewer } = view;
  const maxHp = viewer.stats.find((stat) => stat.key === "maxHp")?.value ?? 0;
  const open = (next: Sheet) => setSheet(next);
  const close = () => setSheet(null);

  function renderSheet(opened: Sheet) {
    const key = opened.kind;
    switch (opened.kind) {
      case "me":
        return (
          <Dialog key={key} title="本人" onClose={close}>
            <MePanel view={view} />
          </Dialog>
        );
      case "inventory":
        return (
          <Dialog key={key} title="背包" onClose={close} variant="gridfill">
            <InventoryPanel items={view.viewer.items} />
          </Dialog>
        );
      case "people":
        return (
          <Dialog key={key} title="相识" onClose={close} variant="gridfill">
            <PeoplePanel view={view} />
          </Dialog>
        );
      case "places":
        return (
          <Dialog key={key} title="行迹" onClose={close} variant="gridfill">
            <PlacesPanel view={view} />
          </Dialog>
        );
      case "stage":
        return (
          <Dialog key={key} title={stage.name} onClose={close} variant="gridfill">
            <StagePanel view={view} />
          </Dialog>
        );
      case "anchor":
        return (
          <Dialog key={key} title={opened.anchor.label} onClose={close} variant="gridfill">
            <AnchorPanel anchor={opened.anchor} />
          </Dialog>
        );
      case "actor":
        return (
          <Dialog key={key} title={opened.actor.name} onClose={close}>
            <ActorPanel actor={opened.actor} />
          </Dialog>
        );
      case "act":
        return renderTurn({ slug: view.game.slug, onClose: close });
      case "history":
        return renderHistory({ slug: view.game.slug, onClose: close });
    }
  }

  return (
    <main className="game">
      <nav className="game__bar">
        <div className="game__identity">
          <button
            type="button"
            className="avatar"
            aria-label="本人"
            onClick={() => open({ kind: "me" })}
          >
            <span aria-hidden="true">{initialOf(viewer.name)}</span>
          </button>
          <dl className="vitals">
            <div className="vitals__hp">
              <dt>生命</dt>
              <dd>
                {viewer.hp}
                <span className="vitals__max"> / {maxHp}</span>
              </dd>
            </div>
            {viewer.stats
              .filter((stat) => stat.key !== "maxHp")
              .map((stat) => (
                <div key={stat.key}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
          </dl>
        </div>

        <div className="game__actions">
          <button type="button" className="action" onClick={() => open({ kind: "act" })}>
            动作
          </button>
          <button type="button" className="action" onClick={() => open({ kind: "inventory" })}>
            背包
          </button>
          <button type="button" className="action" onClick={() => open({ kind: "people" })}>
            相识
          </button>
          <button type="button" className="action" onClick={() => open({ kind: "places" })}>
            行迹
          </button>
          <button type="button" className="action" onClick={() => open({ kind: "history" })}>
            记录
          </button>
        </div>
      </nav>

      {notice === undefined ? null : <div className="game__notice">{notice}</div>}

      <section className="board" aria-label="当前舞台">
        <ul className="board__row">
          <li>
            <button type="button" className="card" onClick={() => open({ kind: "stage" })}>
              <span className="card__kind">舞台</span>
              <span className="card__title">{stage.name}</span>
              <span className="card__hint">
                {/* 环境原文可能是整段（真实数据两百多字），卡面只放开头几行当摘要。 */}
                <span className="card__line card__line--clamp">{stage.environment}</span>
                <span className="card__line card__count">
                  出口 {stage.exits.length + stage.sealedExits.length}
                </span>
              </span>
            </button>
          </li>

          {stage.anchors.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="card"
                onClick={() => open({ kind: "anchor", anchor: item })}
              >
                <span className="card__kind">锚点</span>
                <span className="card__title">{item.label}</span>
                <span className="card__hint">
                  {item.description === undefined ? null : (
                    <span className="card__line">{item.description}</span>
                  )}
                  {item.items.length === 0 ? (
                    <span className="card__line">空的</span>
                  ) : (
                    <span className="card__line card__count">道具 {item.items.length}</span>
                  )}
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
                  item.self ? open({ kind: "me" }) : open({ kind: "actor", actor: item })
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
      </section>

      {sheet === null ? null : renderSheet(sheet)}
    </main>
  );
}

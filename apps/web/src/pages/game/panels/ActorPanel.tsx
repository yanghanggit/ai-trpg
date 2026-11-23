import type { GameView } from "../../../features/games/useGameView";

type Card = GameView["stage"]["actors"][number];

/** 「角色」浮窗：别人身上我看得见的部分；自己的明细在「我」里。 */
export default function ActorPanel({ actor }: { actor: Card }) {
  return (
    <>
      <dl className="rows">
        <div>
          <dt>称呼</dt>
          <dd>{actor.name}</dd>
        </div>
        <div>
          <dt>编号</dt>
          <dd>
            <code>{actor.token}</code>
          </dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{actor.alive ? "活着" : "已死"}</dd>
        </div>
      </dl>
      <p className="prose">{actor.appearance}</p>
    </>
  );
}

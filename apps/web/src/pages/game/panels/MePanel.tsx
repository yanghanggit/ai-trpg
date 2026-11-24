import type { GameView } from "../../../features/games/useGameView";

/** 「我」：局的信息连同角色明细，一行一项，不铺卡片。 */
export default function MePanel({ view }: { view: GameView }) {
  const { game, viewer, stage } = view;
  const self = stage.actors.find((actor) => actor.self);

  return (
    <dl className="rows">
      <div>
        <dt>局</dt>
        <dd>{game.name}</dd>
      </div>
      <div>
        <dt>slug</dt>
        <dd>
          <code>{game.slug}</code>
        </dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{game.status}</dd>
      </div>
      <div>
        <dt>版本</dt>
        <dd>
          v{game.version} · {game.contentVersion}
        </dd>
      </div>
      <div>
        <dt>名字</dt>
        <dd>{viewer.name}</dd>
      </div>
      <div>
        <dt>引用</dt>
        <dd>{self?.token ?? "—"}</dd>
      </div>
      <div>
        <dt>隐匿</dt>
        <dd>{viewer.concealed ? "对旁人不可见" : "未隐匿"}</dd>
      </div>
      <div>
        <dt>外观</dt>
        <dd>{viewer.appearance}</dd>
      </div>
    </dl>
  );
}

import type { GameView } from "../../../features/games/useGameView";

type MePanelProps = {
  view: GameView;
  /** 打开 inventory（界面上叫「背包」）；自己那几件道具不铺在这里。 */
  onOpenInventory: () => void;
};

/**
 * 「本人」：局的信息、角色明细、属性读数，以及通往 inventory 的入口。
 *
 * 属性只列源属性现值（本体 + 穿戴 + 状态效果）；伤害、格挡是动手那一刻的顺时输出，
 * 不上面板。道具单独一个浮窗：数量不固定，需要自己的网格与滚动。
 */
export default function MePanel({ view, onOpenInventory }: MePanelProps) {
  const { game, viewer, stage } = view;
  const self = stage.actors.find((actor) => actor.self);
  const maxHp = viewer.stats.find((stat) => stat.key === "maxHp")?.value ?? 0;

  return (
    <>
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

      <h3 className="group">属性</h3>
      <dl className="rows">
        <div>
          <dt>生命</dt>
          <dd>
            {viewer.hp} / {maxHp}
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

      <button type="button" className="button" onClick={onOpenInventory}>
        背包
        <span className="button__note">{viewer.items.length} 件</span>
      </button>
    </>
  );
}

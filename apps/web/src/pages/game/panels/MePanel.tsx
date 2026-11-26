import type { GameView } from "../../../features/games/useGameView";

/**
 * 「本人」：局的信息、角色明细与属性读数。
 *
 * 属性只列源属性现值（本体 + 穿戴 + 状态效果）；伤害、格挡是动手那一刻的顺时输出，
 * 不上面板。道具在「背包」里，它有自己的一格网格入口。
 */
export default function MePanel({ view }: { view: GameView }) {
  const { game, viewer, stage } = view;
  const self = stage.actors.find((actor) => actor.self);
  const maxHp = viewer.stats.find((stat) => stat.key === "maxHp")?.value ?? 0;

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
      <div>
        {/* 顶部条上已经有这组读数，这里压成一行，只为回看时不用抬头。 */}
        <dt>属性</dt>
        <dd className="readout">{readoutOf(viewer, maxHp)}</dd>
      </div>
    </dl>
  );
}

/** 一行读数：`生命 9 / 12 · 力量 4 · …`；顺序跟引擎给的属性顺序走。 */
function readoutOf(viewer: GameView["viewer"], maxHp: number): string {
  const parts = [`生命 ${viewer.hp} / ${maxHp}`];
  for (const stat of viewer.stats) {
    if (stat.key !== "maxHp") {
      parts.push(`${stat.label} ${stat.value}`);
    }
  }
  return parts.join(" · ");
}

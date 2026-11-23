import type { GameView } from "../../../features/games/useGameView";

/** 「我」的明细：主页面不常看，点开才需要。 */
export default function MePanel({ view }: { view: GameView }) {
  const { viewer, stage, signatureNames } = view;
  const self = stage.actors.find((actor) => actor.self);

  return (
    <dl className="facts">
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
        <dd>{viewer.concealed ? "对身体之外的人不可见" : "未隐匿"}</dd>
      </div>
      <div>
        <dt>此刻的样子</dt>
        <dd>{viewer.appearance}</dd>
      </div>
      <div>
        <dt>我这样称呼别人</dt>
        <dd>
          {signatureNames.length === 0
            ? "还没有认得的人。"
            : signatureNames.map((entry) => entry.name).join("、")}
        </dd>
      </div>
    </dl>
  );
}

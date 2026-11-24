import type { GameView } from "../../../features/games/useGameView";

type Stage = GameView["stage"];
type Exit = { stageId: string; name: string; ref: string | null; sealed: boolean };

/**
 * 「舞台」浮窗：环境原文，以及从这里能去哪。
 *
 * 环境这段文字是写给模型看的上下文，主页不铺它；客户端将来会用文生图表达，现在先按原样给人读。
 * 出口排在环境下面：走过去是一次动作提交（要判门、要过回合），现在点下去只打日志。
 */
export default function StagePanel({ view }: { view: GameView }) {
  const { stage } = view;
  const exits = exitsOf(stage);

  return (
    <>
      <p className="prose">{stage.environment}</p>
      <p className="muted">
        锚点 {stage.anchors.length} · 在场 {stage.actors.length} · 出口 {exits.length}
      </p>

      {exits.length === 0 ? (
        <p className="muted">这里没有出去的路。</p>
      ) : (
        <ul className="stack">
          {exits.map((exit) => (
            <li key={exit.stageId}>
              <button
                type="button"
                className={exit.sealed ? "stack__item stack__item--faded" : "stack__item"}
                onClick={() => console.log("出口", stage.name, exit.name)}
              >
                <span className="stack__name">{exit.name}</span>
                <span className="stack__note">
                  {exit.sealed ? "封着——认得出，但过不去" : "通着"}
                  {exit.ref === null ? "" : ` · ${exit.ref}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 通着的与封着的合成一张表：对观看者来说都是「这里有这么一扇门」。 */
function exitsOf(stage: Stage): Exit[] {
  return [
    ...stage.exits.map((exit) => ({ ...exit, sealed: false })),
    ...stage.sealedExits.map((exit) => ({ ...exit, ref: null, sealed: true })),
  ];
}

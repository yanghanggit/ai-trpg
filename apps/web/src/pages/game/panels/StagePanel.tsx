import type { GameView } from "../../../features/games/useGameView";
import SlotGrid from "./SlotGrid";

type Stage = GameView["stage"];
type Exit = { stageId: string; name: string; ref: string | null; sealed: boolean };

/**
 * 「舞台」浮窗：从这里能去哪。
 *
 * 环境原文在主页那张卡上（那里已经写了开头几行），所以这里只剩出口。
 * 出口是卡片，与道具同一套：走过去是一次动作提交（要判门、要过回合），现在点下去只打日志。
 */
export default function StagePanel({ view }: { view: GameView }) {
  const { stage } = view;
  const exits = exitsOf(stage);

  return (
    <>
      {exits.length === 0 ? (
        <p className="muted">这里没有出去的路。</p>
      ) : (
        <SlotGrid>
          {exits.map((exit) => (
            <li key={exit.stageId}>
              <button
                type="button"
                className={exit.sealed ? "slot slot--action slot--faded" : "slot slot--action"}
                onClick={() => console.log("出口", stage.name, exit.name)}
              >
                <span className="slot__kind">出口</span>
                <span className="slot__name">{exit.name}</span>
                <span className="slot__note">
                  {exit.sealed ? "封着——认得出，但过不去" : "通着"}
                  {exit.ref === null ? "" : ` · ${exit.ref}`}
                </span>
              </button>
            </li>
          ))}
        </SlotGrid>
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

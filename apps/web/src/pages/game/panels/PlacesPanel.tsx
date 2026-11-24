import type { GameView } from "../../../features/games/useGameView";
import SlotGrid from "./SlotGrid";

/**
 * 「行迹」：走过的舞台，一格一个。
 *
 * 点下去只打日志：走过去是一次动作提交（要判出口、要过回合），
 * 而这份名单是「去过哪」的回顾，不是可点的行动清单。等动作入口做好再接。
 */
export default function PlacesPanel({ view }: { view: GameView }) {
  const { visitedStages } = view;

  if (visitedStages.length === 0) {
    return <p className="muted">还没去过别的地方。</p>;
  }

  return (
    <SlotGrid>
      {visitedStages.map((place) => (
        <li key={place.stageId}>
          <button
            type="button"
            className="slot slot--action"
            onClick={() => console.log("行迹", place.name, place.stageId)}
          >
            <span className="slot__kind">舞台</span>
            <span className="slot__name">{place.name}</span>
          </button>
        </li>
      ))}
    </SlotGrid>
  );
}

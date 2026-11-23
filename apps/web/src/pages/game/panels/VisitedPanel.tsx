import type { GameView } from "../../../features/games/useGameView";

/** 去过的地方：地图这件事不常看，放进浮窗。 */
export default function VisitedPanel({ view }: { view: GameView }) {
  const { visitedStages } = view;

  return (
    <>
      <h3>去过</h3>
      {visitedStages.length > 0 ? (
        <ul className="chips">
          {visitedStages.map((candidate) => (
            <li key={candidate.stageId} className="chip">
              {candidate.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">还没去过别的地方。</p>
      )}
    </>
  );
}

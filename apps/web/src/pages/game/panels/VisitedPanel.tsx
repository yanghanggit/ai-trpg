import type { GameView } from "../../../features/games/useGameView";

/** 去过的地方与可传送目标：地图这件事不常看，放进浮窗。 */
export default function VisitedPanel({ view }: { view: GameView }) {
  const { visitedStages, teleportTargets } = view;

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

      <h3>可传送</h3>
      {teleportTargets.length > 0 ? (
        <ul className="chips">
          {teleportTargets.map((target) => (
            <li key={target.stageId} className="chip">
              {target.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">没有可传送的舞台。</p>
      )}
    </>
  );
}

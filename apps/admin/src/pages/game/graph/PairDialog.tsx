import Dialog from "../../../components/Dialog";
import type { GameGraph } from "../../../features/games/useGameGraph";
import type { ConnectionPair } from "./viewModel";

type Props = {
  graph: GameGraph;
  pair?: ConnectionPair;
  onClose: () => void;
};

const PASSAGE_LABELS: Record<"open" | "sealed", string> = {
  open: "可通行",
  sealed: "封锁（sealed）",
};

/**
 * 连线的弹窗：这条线有哪几个方向、各自通不通。
 *
 * 图上一根线只画得下箭头，画不下「为什么封着」——那类东西以后往这里加，
 * 线本身不用再变。
 */
export default function PairDialog({ graph, pair, onClose }: Props) {
  const nameOf = (stageId: string) =>
    graph.stages.find((stage) => stage.id === stageId)?.name ?? stageId;

  const title =
    pair === undefined ? "连线" : `${nameOf(pair.stageIds[0])} ↔ ${nameOf(pair.stageIds[1])}`;

  return (
    <Dialog open={pair !== undefined} onClose={onClose} title={title}>
      {pair === undefined ? null : (
        <ul className="inspector__list">
          {pair.directions.map((direction) => (
            <li key={`${direction.from}->${direction.to}`}>
              <span>
                {nameOf(direction.from)} → {nameOf(direction.to)}
              </span>
              <span className={direction.passage === "open" ? "badge badge--ok" : "badge"}>
                {PASSAGE_LABELS[direction.passage]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

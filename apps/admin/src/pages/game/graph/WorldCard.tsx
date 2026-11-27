import { useMemo } from "react";
import Hint from "../../../components/Hint";
import type { GameGraph } from "../../../features/games/useGameGraph";
import FlowCanvas from "./FlowCanvas";
import { worldFlow } from "./flow";

type Props = {
  graph?: GameGraph;
  error?: string;
  /** 点舞台：打开第二层，落在那个舞台。 */
  onOpen: (stageId: string, actorId?: string) => void;
};

/**
 * 控制台顶部的「世界图谱」：一眼看清有几处、谁在哪、下一个轮到谁。
 *
 * 它只读，不再是操作面板：要推进仍走下面的「推进」。点舞台进第二层——
 * 舞台为根、actor 按顺位排；再点人看它身上带着什么。
 */
export default function WorldCard({ graph, error, onOpen }: Props) {
  const flow = useMemo(
    () => (graph === undefined ? { nodes: [], edges: [] } : worldFlow(graph)),
    [graph],
  );

  return (
    <section className="panel panel--graph">
      <h2>
        世界图谱
        <Hint text="一条线连两个舞台：箭头数=方向数，实线=至少一个方向能走，虚线=两个方向都封着，灰箭头=那个方向封着（sealed）。带「轮到」标记的舞台里站着顺位上的下一个人。点舞台看里面的人。页头「第 N 刻」是本局已落账的回合数：舞台回合与世界回合也推进它，所以它通常大于顺位上各人的回合数。" />
      </h2>

      {error === undefined ? null : <p className="form-error">{error}</p>}

      {graph === undefined ? (
        error === undefined ? (
          <p className="muted">读取中…</p>
        ) : null
      ) : (
        <>
          <p className="muted">
            {graph.world.name} · {graph.stages.length} 个舞台 · {graph.actors.length} 个角色 · 第{" "}
            {graph.game.clock} 刻
          </p>
          <FlowCanvas
            className="graph-canvas graph-canvas--card"
            nodes={flow.nodes}
            edges={flow.edges}
            zoomOnScroll={false}
            onStageClick={(stageId) => onOpen(stageId)}
          />
        </>
      )}
    </section>
  );
}

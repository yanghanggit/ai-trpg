import { useMemo } from "react";
import Hint from "../../../components/Hint";
import type { GameGraph } from "../../../features/games/useGameGraph";
import FlowCanvas from "./FlowCanvas";
import { actorStageId, preferredStageId, worldFlow } from "./flow";
import QueueStrip from "./QueueStrip";
import { queueRows } from "./viewModel";

type Props = {
  graph?: GameGraph;
  error?: string;
  /** 点舞台或顺位条：打开第二层，落在那个舞台 / 那个人。 */
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
  const rows = useMemo(() => (graph === undefined ? [] : queueRows(graph)), [graph]);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          世界图谱
          <Hint text="实线=能走，虚线=封锁（sealed）；带「轮到」标记的舞台里站着顺位上的下一个人。点舞台看里面的人，点顺位条直接跳到那个人。" />
        </h2>
        <button
          type="button"
          className="button button--ghost"
          disabled={graph === undefined}
          onClick={() => {
            if (graph === undefined) {
              return;
            }
            const stageId = preferredStageId(graph);
            if (stageId !== undefined) {
              onOpen(stageId);
            }
          }}
        >
          展开
        </button>
      </div>

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
          <QueueStrip
            rows={rows}
            onSelect={(actorId) => {
              const stageId = actorStageId(graph, actorId) ?? preferredStageId(graph);
              if (stageId !== undefined) {
                onOpen(stageId, actorId);
              }
            }}
          />
        </>
      )}
    </section>
  );
}

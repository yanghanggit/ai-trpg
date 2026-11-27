import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { nodeTypes } from "./flow";
import type { ConnectionPair } from "./viewModel";

type Props = {
  nodes: Node[];
  edges: Edge[];
  /** 画布容器：高度由外层给，xyflow 自己不撑高。 */
  className: string;
  onStageClick?: (stageId: string) => void;
  onActorClick?: (actorId: string) => void;
  /** 点线：一对舞台的两个方向各自通不通。 */
  onPairClick?: (pair: ConnectionPair) => void;
  draggable?: boolean;
  /** 卡片里关掉滚轮缩放，别抢页面滚动。 */
  zoomOnScroll?: boolean;
};

/**
 * 画布的公共壳：卡片与弹窗共用一份配置。
 *
 * 每个实例自带 `ReactFlowProvider`——同页会有两张图（控制台一张、弹窗一张），
 * 共用一份内部 store 会让视口与选中互相串。
 */
export default function FlowCanvas({
  nodes,
  edges,
  className,
  onStageClick,
  onActorClick,
  onPairClick,
  draggable = false,
  zoomOnScroll = true,
}: Props) {
  return (
    <div className={className}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: "12%" }}
          minZoom={0.25}
          maxZoom={1.75}
          nodesDraggable={draggable}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={zoomOnScroll}
          preventScrolling={false}
          forceColorMode="dark"
          onEdgeClick={(_event, edge) => {
            const data = edge.data as { pair?: ConnectionPair } | undefined;
            if (data?.pair !== undefined) {
              onPairClick?.(data.pair);
            }
          }}
          onNodeClick={(_event, node) => {
            if (node.type === "stage") {
              onStageClick?.(node.id);
            } else {
              onActorClick?.(node.id);
            }
          }}
        >
          <Background gap={22} size={1} color="rgb(139 155 176 / 18%)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

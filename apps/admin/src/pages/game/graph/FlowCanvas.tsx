import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useRef } from "react";
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
export default function FlowCanvas(props: Props) {
  return (
    <div className={props.className}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

/**
 * 画布本体。
 *
 * 首次拿到节点时自己居中一次：`fitView` 只在初始化那一刻生效，而节点是异步来的，
 * 空图初始化等于没居中，画布一放大就只剩中间一小撮。只居中一次——自动刷新时不重排、
 * 不重置视口，是这张图的既有约定。
 */
function Canvas({
  nodes,
  edges,
  onStageClick,
  onActorClick,
  onPairClick,
  draggable = false,
  zoomOnScroll = true,
}: Omit<Props, "className">) {
  const { fitView, getNodes } = useReactFlow();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || nodes.length === 0) {
      return;
    }
    // 节点尺寸要等 xyflow 自己量完：量之前 fitView 算出的边界是错的（会溢出画布），
    // 所以每 100ms 探一次，量齐了才居中，最多等 1.5 秒。
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const measured = getNodes();
      // v13 把量出来的尺寸写在 `width/height` 上（不是 v12 的 `measured`）。
      if (measured.length > 0 && measured.every((node) => (node.width ?? 0) > 0)) {
        fitted.current = true;
        window.clearInterval(timer);
        void fitView({ padding: 0.18, maxZoom: 1.2 });
        return;
      }
      if (tries > 15) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [fitView, getNodes, nodes.length]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
  );
}

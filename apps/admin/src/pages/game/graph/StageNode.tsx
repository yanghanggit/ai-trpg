import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { StageFlowNode } from "./types";

/**
 * 舞台节点。
 *
 * 三个出口：左右连舞台之间的通路（有向边），下面挂本舞台的 actor（第二层用）。
 * 人都空着的舞台也画——这是上帝视角，看得见的地方不因为没人就不存在。
 */
export default function StageNode({ data }: NodeProps<StageFlowNode>) {
  const classes = ["graph-node", "graph-node--stage"];
  if (data.isNext) {
    classes.push("graph-node--next");
  }
  if (data.ghost === true) {
    classes.push("graph-node--ghost");
  }
  if (data.root === true) {
    classes.push("graph-node--root");
  }

  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Left} id="left" isConnectable={false} />
      <span className="graph-node__title">{data.name}</span>
      <span className="graph-node__meta">
        <code>#{data.seq}</code>
        <span className="graph-node__dot">·</span>
        {data.people} 人{data.isNext ? <span className="graph-node__flag">轮到</span> : null}
      </span>
      <Handle type="source" position={Position.Right} id="right" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={false} />
    </div>
  );
}

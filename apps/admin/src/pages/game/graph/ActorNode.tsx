import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ActorFlowNode } from "./types";

/**
 * actor 节点：第二层的一行。
 *
 * 名次、血量、控制方都写卡上，是因为这一层的排序就是顺位，别的读法在这里都不成立；
 * 谁死了、谁藏着也不该点开才知道。
 */
export default function ActorNode({ data }: NodeProps<ActorFlowNode>) {
  const classes = ["graph-node", "graph-node--actor"];
  if (data.isNext) {
    classes.push("graph-node--next");
  }
  if (!data.alive) {
    classes.push("graph-node--dead");
  }

  const ratio = data.maxHp <= 0 ? 0 : Math.min(1, Math.max(0, data.hp / data.maxHp));

  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Top} id="top" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={false} />
      <span className="graph-node__head">
        {data.position === undefined ? null : (
          <span className="graph-node__pos">{data.position}</span>
        )}
        <span className="graph-node__title">{data.name}</span>
        {data.concealed ? <span className="graph-node__tag">隐匿</span> : null}
        {data.isNext ? <span className="graph-node__flag">轮到</span> : null}
      </span>
      <span className="graph-node__meta">
        <code>#{data.seq}</code>
        <span className="graph-node__dot">·</span>
        hp {data.hp}/{data.maxHp}
        {data.control === undefined ? null : (
          <>
            <span className="graph-node__dot">·</span>
            {data.control === "player" ? "玩家" : "NPC"}
          </>
        )}
        {data.turnsTaken === undefined ? null : (
          <>
            <span className="graph-node__dot">·</span>
            {data.turnsTaken} 回合
          </>
        )}
      </span>
      <span className="graph-node__bar" aria-hidden="true">
        <span className="graph-node__bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </div>
  );
}

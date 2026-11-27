import { BaseEdge, type EdgeProps } from "@xyflow/react";

export type CurveData = {
  /** 双向边各偏一侧：两条边叠在一起时，箭头会让人误以为只有单向。 */
  offset?: number;
  /** `h` 是左右相接（舞台之间），`v` 是上下相接（舞台 → actor）。 */
  axis?: "h" | "v";
};

/**
 * 自定义边：一条二次曲线，可以按 `offset` 垂直（或水平）撇开一点。
 *
 * 用它而不是内置的 bezier，是因为内置的曲线两端控制点完全由端点决定：
 * A→B 与 B→A 会画成同一条线，只剩一个箭头露在外面。世界图的边是有向的，
 * 双向通行在内容里就是两条边，画布上也得看得出是两条。
 */
export default function CurvedEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const curve = data as CurveData | undefined;
  const offset = curve?.offset ?? 0;
  const axis = curve?.axis ?? "h";

  const path =
    axis === "v"
      ? (() => {
          const dy = Math.max(30, Math.abs(targetY - sourceY) * 0.45);
          return `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY + dy}, ${targetX + offset} ${targetY - dy}, ${targetX} ${targetY}`;
        })()
      : (() => {
          // 反向边（目标在左）要把控制点翻到左边，否则曲线会先向右甩出去再折回来。
          const direction = targetX >= sourceX ? 1 : -1;
          const dx = Math.max(48, Math.abs(targetX - sourceX) * 0.45);
          return `M ${sourceX} ${sourceY} C ${sourceX + direction * dx} ${sourceY + offset}, ${targetX - direction * dx} ${targetY + offset}, ${targetX} ${targetY}`;
        })();

  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

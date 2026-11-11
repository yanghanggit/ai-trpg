/**
 * 场景的文本投影：可交互锚点与挂在上面的物品。
 *
 * stage 与 actor 看同一份公开列表，所以渲染只有一份；两者的差别在「谁能看」与
 * 「名字怎么叫」，那部分在各自的回合与 `client-view/` 里。
 */

import { itemSourceNote } from "../item-state/describe";
import type { StageAnchorState, StageState } from "../kernel/types";

/** 场景锚点的统一渲染：stage 与 actor 都看同一份公开列表，物品作为子项挂在锚点下。 */
export function describeStageAnchors(anchors: readonly StageAnchorState[]): string {
  if (anchors.length === 0) {
    return "无";
  }
  return anchors
    .flatMap((anchor) => {
      const head = anchor.description
        ? `- ${anchor.label}：${anchor.description}`
        : `- ${anchor.label}`;
      const items = anchor.items.map(
        (item) => `  - ${item.name}（${item.kind}${itemSourceNote(item)}）：${item.description}`,
      );
      return [head, ...items];
    })
    .join("\n");
}

/** 场景里可拾取的物品名：物品挂在锚点上，顺序沿用锚点与物品的稳定序号。 */
export function stageItemNames(stage: Pick<StageState, "anchors">): string[] {
  return stage.anchors.flatMap((anchor) => anchor.items.map((item) => item.name));
}

/** 锚点连物品一起给；只列标签会丢掉 use 与 pickup 需要的细节。 */
export function describeStageAnchorsSection(anchors: readonly StageAnchorState[]): string {
  return anchors.length === 0 ? "可交互：无" : `可交互：\n${describeStageAnchors(anchors)}`;
}

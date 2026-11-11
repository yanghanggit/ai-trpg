import { randomUUID } from "node:crypto";
import { GameError } from "../../errors";
import { MAX_STAGE_ANCHORS } from "../../kernel/limits";
import type { StageAction } from "../../kernel/types";

export type StoredAnchor = { key: string; label: string; description?: string };
export type AnchorWrite = Extract<
  StageAction,
  { kind: "add_anchor" | "remove_anchor" | "update_anchor" }
>;

export function isAnchorWrite(action: StageAction): action is AnchorWrite {
  return (
    action.kind === "add_anchor" ||
    action.kind === "remove_anchor" ||
    action.kind === "update_anchor"
  );
}

function anchorText(
  text: string,
  guard: (text: string, label: string) => void,
  what: string,
): string {
  const value = text.trim();
  if (value.length === 0) {
    throw new GameError("invalid_action", `${what} 不能为空。`);
  }
  if (/[\r\n]/.test(value)) {
    throw new GameError("invalid_action", `${what} 不能换行。`);
  }
  guard(value, what);
  return value;
}

export function describeStoredAnchors(anchors: readonly StoredAnchor[]): string {
  return anchors.length === 0
    ? "无"
    : anchors
        .map((anchor) =>
          anchor.description ? `- ${anchor.label}：${anchor.description}` : `- ${anchor.label}`,
        )
        .join("\n");
}

/**
 * 纯计算：校验一条锚点变更并返回新列表与摘要。物品挂在锚点的 key 上：
 * 改写标签不换 key，移除锚点则连带移除它上面的物品。
 */
export function computeAnchorChange(
  current: readonly StoredAnchor[],
  itemsByAnchor: ReadonlyMap<string, readonly string[]>,
  action: AnchorWrite,
  guard: (text: string, label: string) => void,
): { anchors: StoredAnchor[]; summary: string; removedAnchorKey?: string } {
  const anchors = current.map((anchor) => ({ ...anchor }));
  if (action.kind === "add_anchor") {
    if (anchors.length >= MAX_STAGE_ANCHORS) {
      throw new GameError("invalid_action", `锚点最多 ${MAX_STAGE_ANCHORS} 个。`);
    }
    const label = anchorText(action.label, guard, "锚点 label");
    if (anchors.some((anchor) => anchor.label === label)) {
      throw new GameError("invalid_action", `锚点 label 重复：${label}。`);
    }
    const description =
      action.description === undefined
        ? undefined
        : anchorText(action.description, guard, "锚点 description");
    anchors.push({
      key: randomUUID(),
      label,
      ...(description === undefined ? {} : { description }),
    });
    return { anchors, summary: `新增：${label}` };
  }

  const index = anchors.findIndex((anchor) => anchor.label === action.targetAnchor);
  const target = anchors[index];
  if (!target) {
    throw new GameError("invalid_action", `当前舞台没有这个可交互锚点: ${action.targetAnchor}`);
  }
  if (action.kind === "remove_anchor") {
    const removedItems = itemsByAnchor.get(target.key) ?? [];
    anchors.splice(index, 1);
    return {
      anchors,
      summary:
        removedItems.length === 0
          ? `移除：${target.label}`
          : `移除：${target.label}（带走 ${removedItems.join("、")}）`,
      removedAnchorKey: target.key,
    };
  }

  const label = anchorText(action.label, guard, "锚点 label");
  if (anchors.some((anchor, currentIndex) => currentIndex !== index && anchor.label === label)) {
    throw new GameError("invalid_action", `锚点 label 重复：${label}。`);
  }
  const description =
    action.description === undefined
      ? undefined
      : anchorText(action.description, guard, "锚点 description");
  anchors[index] = {
    key: target.key,
    label,
    ...(description === undefined ? {} : { description }),
  };
  return {
    anchors,
    summary: target.label === label ? `更新：${label}` : `更新：${target.label} → ${label}`,
  };
}

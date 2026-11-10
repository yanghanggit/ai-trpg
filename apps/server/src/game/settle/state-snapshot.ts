import { mentionOf } from "../addressing";
import { isAlive, listStageActorViews, stageAddressLookup } from "../lookup";
import { loadActorWithStage } from "../persistence/actors";
import { listStageItems } from "../persistence/items";
import type { Executor } from "../persistence/rows";

/**
 * 行动落账后的“当时状态”，供 actor 长期 memory 使用。
 *
 * 只写观察者视角的地址、场景名与“锚点（其上的物品名）”；不写 environment、外观或背包，
 * 也不使用真实姓名或稳定 id。状态取落账后的最终场景，move / teleport 才不会写成起点。
 */
export async function describeMemoryState(
  executor: Executor,
  gameId: string,
  actorId: string,
  worldId: string,
): Promise<string | undefined> {
  const current = await loadActorWithStage(executor, actorId, worldId);
  if (!current) {
    return undefined;
  }
  // 同一个事务 executor 上不能并发查询；按顺序读，避免 pg 9 的并发告警。
  const views = await listStageActorViews(executor, current.stage.id);
  const address = await stageAddressLookup(executor, gameId, actorId, current.stage.id);
  const items = await listStageItems(executor, current.stage.id);
  const actors =
    views.length === 0
      ? "无"
      : views
          .map(({ actor }) => {
            const label = mentionOf(address(actor.id));
            return `${label}${isAlive(actor) ? "" : "（已死亡）"}`;
          })
          .join("、");
  const itemsByAnchor = new Map<string, string[]>();
  for (const item of items) {
    const list = itemsByAnchor.get(item.anchorKey) ?? [];
    list.push(item.name);
    itemsByAnchor.set(item.anchorKey, list);
  }
  const anchors =
    current.stage.anchors.length === 0
      ? "无"
      : current.stage.anchors
          .map((anchor) => {
            const names = itemsByAnchor.get(anchor.key) ?? [];
            return names.length === 0 ? anchor.label : `${anchor.label}（${names.join("、")}）`;
          })
          .join("、");
  return `# 当时
场景：${current.stage.name}
在场：${actors}
可交互：${anchors}`;
}

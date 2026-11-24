import {
  type GameStateSlice,
  ITEM_KIND_LABELS,
  type ItemState,
  type StageState,
} from "../kernel/types";
import type { ViewerAnchor, ViewerGame, ViewerItem } from "./types";

/**
 * 两个视图共用的小投影：游戏头与锚点列表。
 *
 * 它们与观察者无关，放在一处比在每个视图里各抄一遍更不容易漂。
 */

export function gameOf(state: GameStateSlice): ViewerGame {
  return {
    id: state.game.id,
    name: state.game.name,
    slug: state.game.slug,
    status: state.game.status,
    version: state.game.version,
    contentVersion: state.game.contentVersion,
  };
}

export function viewerAnchors(stage: Pick<StageState, "anchors">): ViewerAnchor[] {
  return stage.anchors.map((anchor) => ({
    key: anchor.key,
    label: anchor.label,
    ...(anchor.description === undefined ? {} : { description: anchor.description }),
    items: anchor.items.map(viewerItemOf),
  }));
}

/** 道具的世界面：大类同时给枚举值与展示名，客户端不自己翻译。 */
export function viewerItemOf(item: ItemState): ViewerItem {
  return {
    name: item.name,
    kind: item.kind,
    kindLabel: ITEM_KIND_LABELS[item.kind],
    description: item.description,
  };
}

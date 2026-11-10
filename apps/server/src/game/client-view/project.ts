import type { GameStateSlice, StageState } from "../types";
import type { ViewerAnchor, ViewerGame } from "./types";

/**
 * 两个视图共用的小投影：游戏头与锚点列表。
 *
 * 它们与观察者无关，放在一处比在每个视图里各抄一遍更不容易漂。
 */

export function gameOf(state: GameStateSlice): ViewerGame {
  return {
    id: state.game.id,
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
    items: anchor.items.map((item) => ({
      name: item.name,
      kind: item.kind,
      description: item.description,
    })),
  }));
}

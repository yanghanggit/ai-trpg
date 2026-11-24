import type { Wearer } from "./effective";
import { effectiveSourcesOf } from "./effective";
import { GAMEPLAY_RULES, type GameplayRules } from "./rules";

/**
 * 行动次序：敏捷怎么读、并列怎么破，只在这里定义。
 *
 * 读的是**敏捷现值**（本体 + 穿戴 + 状态效果），与面板、察觉同一份口径；排序问的是
 * 「此刻谁更快」，不是谁的基础值高。`agility` 照实返回，由调用方决定要不要留档。
 *
 * 两个口径属于玩法而非台账：死者不参与排序（他这一轮已经不能行动），并列按实体序号
 * 升序（名字会变，同值必须可复现）。快照、编号与计数不在这里——那归 `action-order`。
 */
export type ActionOrderCandidate = Wearer & {
  readonly id: string;
  /** 本局内唯一的实体序号；并列时的兜底，也是关掉敏捷口径后的唯一次序。 */
  readonly seq: number;
  readonly hp: number;
};

export type OrderedActor = {
  readonly actorId: string;
  /** 排序时读到的敏捷现值；即使开关关掉也照实给出，它只是事实，不解释次序。 */
  readonly agility: number;
};

export function orderActors(
  actors: readonly ActionOrderCandidate[],
  rules: GameplayRules = GAMEPLAY_RULES,
): OrderedActor[] {
  return actors
    .filter((actor) => actor.hp > 0)
    .map((actor) => ({
      actorId: actor.id,
      seq: actor.seq,
      agility: effectiveSourcesOf(actor).agility,
    }))
    .sort(
      (left, right) =>
        (rules.actionOrderByAgility ? right.agility - left.agility : 0) || left.seq - right.seq,
    )
    .map(({ actorId, agility }) => ({ actorId, agility }));
}

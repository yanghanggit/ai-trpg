import { type AddressLookup, mentionOf } from "../addressing";
import { MEMORY_KINDS } from "../constants";
import { withAppearances } from "./text";
import type { DamageObservation, ObservationView, StageRef } from "./types";

/**
 * 伤害文案：数值由结算方给出，这里只按行动与视角取舍措词。
 *
 * `strike` / `cleave` / `brawl` / `use` 都会造成伤害，但不是同一件事：标题与措词一律跟着动作走；
 * 只有当事人带剩余生命，旁观者只知道这一下多疼、对方倒没倒下。
 */

/**
 * 伤害行动的动作短语。句式由动作锁定，观察者、落点与视角都不改变它：
 * `strike` 的主体是「挥击」，`cleave` 是「顺劈」，武器只是括注；`brawl` 是「肉搏」；
 * `use` 的主体是「使用道具」。
 */
export function damageActionText(
  action: "strike" | "cleave" | "brawl" | "use",
  itemName?: string,
): string {
  const name = itemName === undefined ? undefined : itemName;
  if (action === "strike") {
    return `挥击${name ? `（使用${name}）` : ""}`;
  }
  if (action === "cleave") {
    return `顺劈${name ? `（使用${name}）` : ""}`;
  }
  if (action === "brawl") {
    return "肉搏";
  }
  return `使用${name ?? "空手"}`;
}

/**
 * 伤害观察：只有当事人带剩余生命，旁观者只知道这一下多疼、对方倒没倒下。
 *
 * 措词取自 `damageActionText`，标题跟着动作：`strike` / `brawl` 为「你被攻击 / 战斗」，
 * `use` 为「你被使用道具 / 场景动态」。
 */
export function renderDamage(
  stage: StageRef,
  observation: DamageObservation,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const { action, attacker, target, itemName, damage, remainingHp, via } = observation;
  const actionText = damageActionText(action, itemName);
  const attackerAddress = address(attacker.id);
  const targetAddress = address(target.id);
  const attackerRef = mentionOf(attackerAddress);
  const targetRef = mentionOf(targetAddress);
  const damageText = via === "affix" ? `词缀追加${damage}点伤害` : `造成${damage}点伤害`;
  // 挥击、顺劈与肉搏都是战斗；使用道具是另一件事。
  const heading =
    action === "use"
      ? { target: "# 你被使用道具", bystander: "# 场景动态" }
      : { target: "# 你被攻击", bystander: "# 战斗" };

  if (observerId === target.id) {
    return {
      content: withAppearances(
        `${heading.target}\n${attackerRef}对你${actionText}，${damageText}；${
          remainingHp <= 0 ? "你倒下了" : `你剩余 HP ${remainingHp}/${target.maxHp}`
        }。`,
        [attackerAddress],
      ),
      metadata: {
        kind: MEMORY_KINDS.actionObservation,
        stageId: stage.id,
        attackerActorId: attacker.id,
      },
    };
  }

  return {
    content: withAppearances(
      `${heading.bystander}\n${attackerRef}对${targetRef}${actionText}，${damageText}${
        remainingHp <= 0 ? `；${targetRef}倒下了` : ""
      }。`,
      [attackerAddress, targetAddress],
    ),
    metadata: {
      kind: MEMORY_KINDS.actionObservation,
      stageId: stage.id,
      attackerActorId: attacker.id,
      targetActorId: target.id,
    },
  };
}

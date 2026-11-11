import { MEMORY_KINDS } from "../../memory/kinds";
import { type AddressLookup, mentionOf } from "../addressing";
import { withAppearances } from "./text";
import type {
  InspectObservation,
  ItemObservation,
  ObservationMetadata,
  ObservationView,
  StageRef,
} from "./types";

/**
 * 物品事件与查看行囊的文案。
 *
 * `steal` 只有当事人视角（写入层已把观察范围收敛成「只有目标」），所以没有旁观分支；
 * 清单只回给查看者自己，`inspect` 的观察不带任何物品名。
 */

/**
 * 查看行囊：目标收到「你被查看」，旁观者只看到场景动态。
 *
 * 查看者自己不在收件人里——清单走他的行动反馈，同一事实只留一条。
 */
export function renderInspect(
  stage: StageRef,
  observation: InspectObservation,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const actorAddress = address(observation.actor.id);
  const targetAddress = address(observation.target.id);
  const metadata: ObservationMetadata = {
    kind: MEMORY_KINDS.actionObservation,
    stageId: stage.id,
    targetActorId: observation.target.id,
  };
  if (observerId === observation.target.id) {
    return {
      content: withAppearances(
        `# 有人在查看你的物品\n${mentionOf(actorAddress)}查看了你随身携带的东西。`,
        [actorAddress],
      ),
      metadata,
    };
  }
  return {
    content: withAppearances(
      `# 场景动态\n${mentionOf(actorAddress)}查看了${mentionOf(targetAddress)}随身携带的东西。`,
      [actorAddress, targetAddress],
    ),
    metadata,
  };
}

/**
 * 物品观察：当事人视角与旁观视角分开给。
 *
 * `steal` 只有当事人视角——它的观察范围在写入层已经收敛成「只有目标」，
 * 所以这里不保留旁观分支。
 */
export function renderItemEvent(
  stage: StageRef,
  observation: ItemObservation,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const { actor } = observation;
  const actorAddress = address(actor.id);
  const actorRef = mentionOf(actorAddress);
  const targetAddress =
    "target" in observation && observation.target ? address(observation.target.id) : null;
  const targetRef = targetAddress ? mentionOf(targetAddress) : "";

  // 搜刮可能一次搬空尸体：句子用列表，metadata 也跟着从单数变复数。
  if (observation.event === "loot") {
    return {
      content: withAppearances(
        `# 场景动态\n${actorRef}从${targetRef}的尸体上搜走了${observation.itemNames.join("、")}。`,
        [actorAddress, ...(targetAddress ? [targetAddress] : [])],
      ),
      metadata: {
        kind: MEMORY_KINDS.actionObservation,
        stageId: stage.id,
        itemNames: observation.itemNames,
        targetActorId: observation.target.id,
      },
    };
  }

  const itemName = observation.itemName;
  const metadata: ObservationMetadata = {
    kind: MEMORY_KINDS.actionObservation,
    stageId: stage.id,
    itemName,
  };

  if (observation.event === "steal") {
    return {
      content: withAppearances(`# 你被窃取\n${actorRef}从你身上取走了${itemName}。`, [
        actorAddress,
      ]),
      metadata,
    };
  }

  if (observation.event === "give" && observerId === observation.target.id) {
    return {
      content: withAppearances(`# 你收到物品\n${actorRef}把${itemName}交给了你。`, [actorAddress]),
      metadata,
    };
  }

  if (observation.event === "use" && observerId === observation.target?.id) {
    return {
      content: withAppearances(`# 你被使用道具\n${actorRef}对你使用了${itemName}。`, [
        actorAddress,
      ]),
      metadata,
    };
  }

  switch (observation.event) {
    case "give":
      return {
        content: withAppearances(`# 场景动态\n${actorRef}把${itemName}交给了${targetRef}。`, [
          actorAddress,
          ...(targetAddress ? [targetAddress] : []),
        ]),
        metadata: { ...metadata, targetActorId: observation.target.id },
      };
    case "pickup":
      return {
        content: withAppearances(
          `# 场景动态\n${actorRef}从${observation.anchorLabel}上拾取了${itemName}。`,
          [actorAddress],
        ),
        metadata: { ...metadata, targetAnchor: observation.anchorLabel },
      };
    case "use": {
      const where = observation.target
        ? `对${targetRef}`
        : `在${stage.name}${observation.targetAnchor ? `的${observation.targetAnchor}` : ""}`;
      return {
        content: withAppearances(`# 场景动态\n${actorRef}${where}使用了${itemName}。`, [
          actorAddress,
          ...(targetAddress ? [targetAddress] : []),
        ]),
        metadata: {
          ...metadata,
          ...(observation.target ? { targetActorId: observation.target.id } : {}),
          ...(observation.targetStageName ? { targetStageName: observation.targetStageName } : {}),
          ...(observation.targetAnchor ? { targetAnchor: observation.targetAnchor } : {}),
        },
      };
    }
  }
}

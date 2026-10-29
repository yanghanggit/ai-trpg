/**
 * 观察与伤害文案的唯一构造点：纯函数，不查库、不写 memory。
 *
 * 每条观察有两种视角：当事人（「你被…」）与旁观者（「场景动态」「战斗」）。这里只把已解析的
 * 事实转成文本 + metadata；谁收到哪一版、写进谁的 memory，由 `observations.ts` 决定。
 * `damageActionText` 是这个文件的另一半职责：一句式的动作短语由动作锁定，公共消息、舞台记忆、
 * 观察与行动反馈共用它，不许各自拼。文本对外可见（测试直接断言内容），改文案要同步测试。
 */

import {
  type Address,
  type AddressLookup,
  appearanceLine,
  mentionOf,
  plainEntityName,
} from "./addressing";
import { MEMORY_KINDS } from "./constants";
import type { ActionKind, CommunicationKind, ItemEventKind, ObservationMetadata } from "./types";

/** 观察对象的最小投影：文案只需要名字，测试也不必构造整行。 */
export type ActorRef = { id: string; name: string };

/** 场景的最小投影：`id` 进 metadata，`name` 进文案。 */
export type StageRef = { id: string; name: string };

/** 观察者范围：整个场景，或只有指定的当事人。 */
export type Audience =
  | { readonly type: "stage" }
  | { readonly type: "only"; readonly actorId: string };

/** 一次观察的落账内容：文本与结构化标注一起写进同一条 memory 消息。 */
export type ObservationView = { content: string; metadata: ObservationMetadata };

/**
 * 沟通观察的输入。
 *
 * 成员与 `CommunicationKind` 对应：除公开宣告外都必须指定目标，
 * 「say 忘了带目标」在这里是不能表示的状态，因此不需要运行期校验。
 */
export type CommunicationObservation = { source: ActorRef; message: string } & (
  | { kind: Exclude<CommunicationKind, "announce">; target: ActorRef }
  | { kind: "announce" }
);

/**
 * 物品观察的输入。
 *
 * 成员与 `ItemEventKind` 对应：`target` 的有无由动作本身决定，不交给调用方记，
 * 于是文案里不再有「某人」这类兜底。
 */
export type ItemObservation = { actor: ActorRef; itemName: string } & (
  | { event: Extract<ItemEventKind, "steal" | "give">; target: ActorRef }
  | {
      event: Extract<ItemEventKind, "use">;
      target?: ActorRef;
      targetStageName?: string;
      targetDetail?: string;
    }
  | { event: "pickup" }
);

/**
 * 未知对方的观察把外观另起一行：句子只留名字或指代，外观不冒充称呼。
 *
 * 外观对认知隔离是必要的（不知道是谁，只能靠样子辨认），但它不是名字，不能塞进句子。
 */
export function withAppearances(content: string, addresses: readonly Address[]): string {
  const lines = addresses
    .map((address) => appearanceLine(address))
    .filter((line): line is string => line !== null);
  const unique = [...new Set(lines)];
  return unique.length === 0
    ? content
    : `${content}

${unique.join("\n")}`;
}

/**
 * 伤害观察的输入：数值由结算方给出，文案只负责按行动与视角取舍。
 *
 * `strike` / `brawl` / `use` 都会造成伤害，但不是同一件事：标题与措词一律跟着动作走。
 */
export type DamageObservation = {
  action: Extract<ActionKind, "strike" | "brawl" | "use">;
  attacker: ActorRef;
  target: ActorRef & { maxHp: number };
  /** 本次动作用到的物品名；`strike` 必填，`use` 省略表示空手。 */
  itemName?: string;
  /** 词缀追加的伤害；默认效果省略。 */
  via?: "affix";
  damage: number;
  remainingHp: number;
};

/** 环境观察：进入场景、场景自身变化这类没有当事人视角的事实。 */
export function renderEnvironmentChange(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.environmentObservation, stageId } };
}

/** 可见行动观察：旁观者只知道场景里发生了什么，不带数值。 */
export function renderAction(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.actionObservation, stageId } };
}

/**
 * 伤害行动的动作短语。句式由动作锁定，观察者、落点与视角都不改变它：
 * `strike` 的主体是「挥击」，武器只是括注；`brawl` 是「肉搏」；`use` 的主体是「使用道具」。
 */
export function damageActionText(action: "strike" | "brawl" | "use", itemName?: string): string {
  const name = itemName === undefined ? undefined : plainEntityName(itemName);
  if (action === "strike") {
    return `挥击${name ? `（使用${name}）` : ""}`;
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
  // 挥击与肉搏都是战斗；使用道具是另一件事。
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
  const itemName = plainEntityName(observation.itemName);
  const actorAddress = address(actor.id);
  const actorRef = mentionOf(actorAddress);
  const targetAddress =
    "target" in observation && observation.target ? address(observation.target.id) : null;
  const targetRef = targetAddress ? mentionOf(targetAddress) : "";
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
        content: withAppearances(`# 场景动态\n${actorRef}拾取了${itemName}。`, [actorAddress]),
        metadata,
      };
    case "use": {
      const where = observation.target
        ? `对${targetRef}`
        : `在${stage.name}${observation.targetDetail ? `的${observation.targetDetail}` : ""}`;
      return {
        content: withAppearances(`# 场景动态\n${actorRef}${where}使用了${itemName}。`, [
          actorAddress,
          ...(targetAddress ? [targetAddress] : []),
        ]),
        metadata: {
          ...metadata,
          ...(observation.target ? { targetActorId: observation.target.id } : {}),
          ...(observation.targetStageName ? { targetStageName: observation.targetStageName } : {}),
          ...(observation.targetDetail ? { targetDetail: observation.targetDetail } : {}),
        },
      };
    }
  }
}

/** 沟通观察：耳语只有对方视角，公开宣告没有目标。 */
export function renderCommunication(
  stage: StageRef,
  observation: CommunicationObservation,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const { source, message } = observation;
  const sourceAddress = address(source.id);
  const sourceRef = mentionOf(sourceAddress);
  const targetAddress = observation.kind === "announce" ? null : address(observation.target.id);

  if (observation.kind === "whisper") {
    return {
      content: withAppearances(
        `# 你听见\n${sourceRef}对你耳语（场景：${stage.name}）：${message}`,
        [sourceAddress],
      ),
      metadata: {
        kind: MEMORY_KINDS.communicationObservation,
        visibility: "private",
        stageId: stage.id,
        sourceActorId: source.id,
        targetActorId: observation.target.id,
      },
    };
  }

  const heardByTarget = observation.kind !== "announce" && observerId === observation.target.id;
  const heard =
    observation.kind === "announce"
      ? `${sourceRef}公开说`
      : heardByTarget
        ? `${sourceRef}对你说`
        : `${sourceRef}对${mentionOf(address(observation.target.id))}说`;

  return {
    content: withAppearances(`# 你听见\n${heard}（场景：${stage.name}）：${message}`, [
      sourceAddress,
      ...(heardByTarget || targetAddress === null ? [] : [targetAddress]),
    ]),
    metadata: {
      kind: MEMORY_KINDS.communicationObservation,
      visibility: "stage",
      stageId: stage.id,
      sourceActorId: source.id,
      ...(observation.kind === "announce" ? {} : { targetActorId: observation.target.id }),
    },
  };
}

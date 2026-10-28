/**
 * 观察与伤害文案的唯一构造点：纯函数，不查库、不写 memory。
 *
 * 每条观察有两种视角：当事人（「你被…」）与旁观者（「场景动态」「战斗」）。这里只把已解析的
 * 事实转成文本 + metadata；谁收到哪一版、写进谁的 memory，由 `observations.ts` 决定。
 * `damageActionText` 是这个文件的另一半职责：一句式的动作短语由动作锁定，公共消息、舞台记忆、
 * 观察与行动反馈共用它，不许各自拼。文本对外可见（测试直接断言内容），改文案要同步测试。
 */

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
 * 伤害观察的输入：数值由结算方给出，文案只负责按行动与视角取舍。
 *
 * `attack` 与 `use` 都会造成伤害，但不是同一件事：标题与措词一律跟着动作走，
 * 攻击即使带上了武器也仍叫攻击。
 */
export type DamageObservation = {
  action: Extract<ActionKind, "attack" | "use">;
  attacker: ActorRef;
  target: ActorRef & { maxHp: number };
  /** 本次动作用到的物品名；空手攻击时省略。 */
  itemName?: string;
  /** 词缀追加的伤害；默认效果省略。 */
  via?: "affix";
  damage: number;
  remainingHp: number;
};

/** 环境观察：进入场景、场景自身变化这类没有当事人视角的事实。 */
export function renderEnvironment(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.environmentObservation, stageId } };
}

/** 可见行动观察：旁观者只知道场景里发生了什么，不带数值。 */
export function renderAction(content: string, stageId: string): ObservationView {
  return { content, metadata: { kind: MEMORY_KINDS.actionObservation, stageId } };
}

/**
 * 伤害行动的动作短语。句式由动作锁定，观察者、落点与视角都不改变它：
 * `attack` 的主体是「攻击」，道具只是括注；`use` 的主体是「使用道具」。
 */
export function damageActionText(action: "attack" | "use", itemName?: string): string {
  if (action === "attack") {
    return `攻击${itemName ? `（使用${itemName}）` : ""}`;
  }
  return `使用${itemName ?? "空手"}`;
}

/**
 * 伤害观察：只有当事人带剩余生命，旁观者只知道这一下多疼、对方倒没倒下。
 *
 * 措词取自 `damageActionText`，标题跟着动作：`attack` 为「你被攻击 / 战斗」，
 * `use` 为「你被使用道具 / 场景动态」。
 */
export function renderDamage(
  stage: StageRef,
  observation: DamageObservation,
  observerId: string,
): ObservationView {
  const { action, attacker, target, itemName, damage, remainingHp, via } = observation;
  const actionText = damageActionText(action, itemName);
  const damageText = via === "affix" ? `词缀追加${damage}点伤害` : `造成${damage}点伤害`;
  const heading =
    action === "attack"
      ? { target: "# 你被攻击", bystander: "# 战斗" }
      : { target: "# 你被使用道具", bystander: "# 场景动态" };

  if (observerId === target.id) {
    return {
      content: `${heading.target}\n${attacker.name}对你${actionText}，${damageText}；${
        remainingHp <= 0 ? "你倒下了" : `你剩余 HP ${remainingHp}/${target.maxHp}`
      }。`,
      metadata: {
        kind: MEMORY_KINDS.actionObservation,
        stageId: stage.id,
        attackerActorId: attacker.id,
      },
    };
  }

  return {
    content: `${heading.bystander}\n${attacker.name}对${target.name}${actionText}，${damageText}${
      remainingHp <= 0 ? `；${target.name}倒下了` : ""
    }。`,
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
): ObservationView {
  const { actor, itemName } = observation;
  const metadata: ObservationMetadata = {
    kind: MEMORY_KINDS.actionObservation,
    stageId: stage.id,
    itemName,
  };

  if (observation.event === "steal") {
    return {
      content: `# 你被窃取\n${actor.name}从你身上取走了${itemName}。`,
      metadata,
    };
  }

  if (observation.event === "give" && observerId === observation.target.id) {
    return {
      content: `# 你收到物品\n${actor.name}把${itemName}交给了你。`,
      metadata,
    };
  }

  if (observation.event === "use" && observerId === observation.target?.id) {
    return {
      content: `# 你被使用道具\n${actor.name}对你使用了${itemName}。`,
      metadata,
    };
  }

  switch (observation.event) {
    case "give":
      return {
        content: `# 场景动态\n${actor.name}把${itemName}交给了${observation.target.name}。`,
        metadata: { ...metadata, targetActorId: observation.target.id },
      };
    case "pickup":
      return { content: `# 场景动态\n${actor.name}拾取了${itemName}。`, metadata };
    case "use": {
      const where = observation.target
        ? `对${observation.target.name}`
        : `在${stage.name}${observation.targetDetail ? `的${observation.targetDetail}` : ""}`;
      return {
        content: `# 场景动态\n${actor.name}${where}使用了${itemName}。`,
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
): ObservationView {
  const { source, message } = observation;

  if (observation.kind === "whisper") {
    return {
      content: `# 你听见\n${source.name}对你耳语（场景：${stage.name}）：${message}`,
      metadata: {
        kind: MEMORY_KINDS.communicationObservation,
        visibility: "private",
        stageId: stage.id,
        sourceActorId: source.id,
        targetActorId: observation.target.id,
      },
    };
  }

  const heard =
    observation.kind === "announce"
      ? `${source.name}公开说`
      : observerId === observation.target.id
        ? `${source.name}对你说`
        : `${source.name}对${observation.target.name}说`;

  return {
    content: `# 你听见\n${heard}（场景：${stage.name}）：${message}`,
    metadata: {
      kind: MEMORY_KINDS.communicationObservation,
      visibility: "stage",
      stageId: stage.id,
      sourceActorId: source.id,
      ...(observation.kind === "announce" ? {} : { targetActorId: observation.target.id }),
    },
  };
}

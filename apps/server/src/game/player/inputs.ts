import type { DialogueJudge } from "../agents/dialogue-audit";
import type { EquipmentSlot } from "../kernel/types";
import type { SettleActorPlanOptions } from "../settle";

/**
 * 玩家入口的服务层输入。
 *
 * 这些是 `player*` 函数与路由之间的契约，与模型工具的参数不同：工具只能写引用，
 * 玩家入口是 god view，可以写真名、`#编号` 或 id，由引擎归一。
 *
 * `reason`（对应 agent 的 `mind`）只给开发期 agent / CLI 接管使用；
 * 正式 web 客户端的 DTO 不暴露该字段，路由调用时直接省略。
 */
export type PlayerTalkInput = {
  message: string;
  targetActorRef: string;
  reason?: string;
};

export type PlayerAnnounceInput = {
  message: string;
  reason?: string;
};

/** 跨舞台传音；`targetActorName` 必须是真名，不接受引用或 id。 */
export type PlayerCallInput = {
  message: string;
  targetActorName: string;
  reason?: string;
};

export type PlayerMoveInput = {
  /** 舞台 id、名字或 `#编号`。 */
  targetStageRef: string;
};

export type PlayerTeleportInput = {
  /** 目标舞台的真名；`#编号` 与 id 都不接受，服务端另校验「这个 actor 知道这个真名」。 */
  targetStageRef: string;
};

export type PlayerStrikeInput = {
  targetActorRef: string;
};

export type PlayerBrawlInput = {
  targetActorRef: string;
};

export type PlayerStealInput = {
  targetActorRef: string;
  itemName: string;
};

export type PlayerInspectInput = {
  targetActorRef: string;
};

export type PlayerLootInput = {
  targetActorRef: string;
  /** 省略表示搜刮尸体身上的全部道具。 */
  itemNames?: string[];
};

export type PlayerGiveInput = {
  targetActorRef: string;
  itemName: string;
};

export type PlayerPickupInput = {
  targetAnchor: string;
  itemName: string;
};

export type PlayerEquipInput = {
  itemName: string;
  slot: EquipmentSlot;
};

export type PlayerUnequipInput = {
  slot: EquipmentSlot;
};

export type PlayerUseInput = {
  itemName: string;
  targetActorRef?: string;
  targetStageName?: string;
  targetAnchor?: string;
};

/** 玩家替自己控制的角色记下一个名字；与模型侧的名字更新走同一份计划。 */
export type PlayerRecognizeInput = {
  /** 目标引用：真名或 `#编号`；玩家入口仍走控制面。 */
  targetActorRef: string;
  /** 角色当前想怎么称呼对方；不必是真名。 */
  name: string;
};

/** 玩家入口的依赖：结算的那份，加上台词审核器——审核发生在结算之前。 */
export type PlayerActionOptions = SettleActorPlanOptions & { judge?: DialogueJudge };

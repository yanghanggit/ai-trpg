import type { Skill } from "./types";

/** 窃取技能；只让发起者与目标知道，用于从同场景角色身上转移物品。 */
export const STEAL_SKILL: Skill = {
  key: "steal",
  name: "窃取",
  description: "从同场景的一个角色身上取走一件物品；目标可以已经死亡。",
  broadcast: "private",
  resolution: "computed",
  purposeKinds: ["steal"],
  itemPolicy: "optional",
};

/** 给予技能；把自身物品交给同场景的存活角色。 */
export const GIVE_SKILL: Skill = {
  key: "give",
  name: "给予",
  description: "把自己持有的一件物品交给同场景的一个存活角色。",
  broadcast: "stage",
  resolution: "computed",
  purposeKinds: ["give"],
  itemPolicy: "optional",
};

/** 拾取技能；把当前场景中的物品收进自己的背包。 */
export const PICKUP_SKILL: Skill = {
  key: "pickup",
  name: "拾取",
  description: "拾取当前场景中的一件物品。",
  broadcast: "stage",
  resolution: "computed",
  purposeKinds: ["pickup"],
  itemPolicy: "optional",
};

/** 通用物品/身体行动；damage 走战斗计算，use 走物品使用。 */
export const USE_ITEM_SKILL: Skill = {
  key: "use_item",
  name: "使用",
  description: "使用自身物品或空手执行一个意图；伤害意图可用武器强化，使用意图需要指定物品与目标。",
  broadcast: "stage",
  resolution: "computed",
  purposeKinds: ["damage", "use"],
  itemPolicy: "optional",
};

/** 封骨之门与钥匙的硬编码通关条件；后续再迁移到内容数据。 */
export const SEALED_GATE_STAGE_NAME = "场景.封骨之门";
export const SEALED_GATE_KEY_NAME = "饰品.封骨钥匙";

/** 当前可用的技能目录；actor 的 skills 从这里取用。 */
export const SKILLS = [STEAL_SKILL, GIVE_SKILL, PICKUP_SKILL, USE_ITEM_SKILL] as const;

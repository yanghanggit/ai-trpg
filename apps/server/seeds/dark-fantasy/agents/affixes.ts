import type { WorldFunctionSpec } from "./spec";

/** 词缀判定：一次攻击里词缀造成了什么后果。 */
export const AFFIXES_SPEC = {
  label: "词缀判定",
  duty: "判定一次攻击里词缀造成了什么后果，并按这个世界的因果写出旁人看得见的变化。",
  profile: `词缀的理由与后果都用这个世界的因果：血、锈、灰、鼠患、钟声、疖病。可见后果写成旁人看得见的变化，不引入现实科技与设定之外的效果。`,
  constraints: `判定只决定这次攻击在这个世界里意味着什么；伤害与减伤的数值由引擎结算。`,
} satisfies WorldFunctionSpec;

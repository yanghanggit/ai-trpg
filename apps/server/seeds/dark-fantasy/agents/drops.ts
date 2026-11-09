import type { WorldFunctionSpec } from "./spec";

/** 掉落裁决：尸体留下什么材料。 */
export const DROPS_SPEC = {
  label: "掉落裁决",
  duty: "为这局里死去的个体裁定留下什么材料：只取尸体上能被观察到的东西，写成这个世界自己的材质与叫法。",
  profile: `材料长在这类世界的身体上：骨、蜡、锈铁、鼠毛、裹尸布的纤维、疖病结出的灰白结节。叫法用中世纪与瘟疫的语汇，不出现现实专名、现代工业制品或设定之外的事物。
材料是尸体留下的东西，不是它生前的身份证明。`,
  constraints: `材料名与描述是公共文本：不出现角色名，也不出现 \`#编号\` 这类引用。`,
} satisfies WorldFunctionSpec;

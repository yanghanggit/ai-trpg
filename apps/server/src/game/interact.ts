import type { InteractBranch, InteractPurposeKind } from "./types";

/**
 * 交互分支目录：purpose → 行为属性。
 *
 * `purpose` 的可选值全部来自这里，与 actor 掌握什么无关；技能暂时未接入，
 * 攻击走 `damage` 分支，窃取/给予/拾取/使用各有自己的分支。
 */
export const INTERACT_BRANCHES = {
  damage: { broadcast: "stage", resolution: "computed" },
  steal: { broadcast: "private", resolution: "computed" },
  give: { broadcast: "stage", resolution: "computed" },
  pickup: { broadcast: "stage", resolution: "computed" },
  use: { broadcast: "stage", resolution: "computed" },
} as const satisfies Record<InteractPurposeKind, InteractBranch>;

/** 交互分支的全部 kind；工具 enum 与校验都以它为准。 */
export const INTERACT_PURPOSE_KINDS = Object.keys(INTERACT_BRANCHES) as InteractPurposeKind[];

/** 判断未知值是否为合法交互分支。 */
export function isInteractPurposeKind(value: unknown): value is InteractPurposeKind {
  return typeof value === "string" && (INTERACT_PURPOSE_KINDS as readonly string[]).includes(value);
}

/** 读取交互分支的行为属性。 */
export function interactBranch(kind: InteractPurposeKind): InteractBranch {
  return INTERACT_BRANCHES[kind];
}

/** 封骨之门与钥匙的硬编码通关条件；后续再迁移到内容数据。 */
export const SEALED_GATE_STAGE_NAME = "场景.封骨之门";
export const SEALED_GATE_KEY_NAME = "饰品.封骨钥匙";

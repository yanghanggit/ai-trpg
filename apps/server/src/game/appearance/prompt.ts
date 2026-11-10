import type { ToolDefinition } from "../../llm/types";
import { assertWorldFaceText } from "../addressing";
import { GameError } from "../errors";
import { equippedItems } from "../item-state";
import { type ActorState, type AppearanceWornItem, EQUIPMENT_SLOT_LABELS } from "../types";

/**
 * 外观推理的提交契约与共享片段：终止工具、产出校验、穿戴解析与可见性规则。
 *
 * `update` 的任务文本在本模块；`death` 的任务文本在 `death/corpse-appearance.ts`——
 * 任务文本归业务，这里只留两边共用的部分，不靠开关拼。
 */

/** 外观推理的终止工具。 */
export function buildSubmitAppearanceTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_appearance",
      description: "提交重新推理后的当前可见外观。",
      parameters: {
        type: "object",
        properties: {
          appearance: {
            type: "string",
            description: "融合形态、当前穿戴与自身润色后的第三人称外观快照",
          },
        },
        required: ["appearance"],
      },
    },
  };
}

export function parseAppearance(
  args: Record<string, unknown>,
  actorNames: readonly string[] = [],
): string {
  const appearance = typeof args.appearance === "string" ? args.appearance.trim() : "";
  if (appearance.length === 0) {
    throw new GameError("invalid_action", "appearance 不能为空");
  }
  // 外观会进名单与观察（世界面）：名字与引用都不允许混进来。
  assertWorldFaceText(appearance, actorNames, "appearance");
  return appearance;
}

/**
 * 参与外观推理的穿戴。
 *
 * 饰品不参与：这个大类在不同题材里语义漂移（它也可能指与外观无关的植入物），引擎只保留
 * 槽位与穿戴索引，外观只消费武器与护甲两个槽。见 docs/data-driven.md。
 */
export function wornForAppearance(actor: ActorState): AppearanceWornItem[] {
  return equippedItems(actor)
    .filter(({ slot }) => slot !== "accessory")
    .map(({ slot, item }) => ({
      slot,
      itemId: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description,
    }));
}

export function renderWorn(worn: readonly AppearanceWornItem[]): string {
  if (worn.length === 0) {
    return "无";
  }
  return worn
    .map(
      ({ slot, name, kind, description }) =>
        `- ${EQUIPMENT_SLOT_LABELS[slot]}：${name}（${kind}）：${description}`,
    )
    .join("\n");
}

/** 外观任务共用的可见性规则。 */
export const VISIBILITY_RULES = `只使用上面列出的穿戴项；没列出的装备不存在，不要虚构。形态里没写到的穿戴视为没有装备。形态已经写定的部分不要改写。

穿戴不等于露出：只写从外面能看见的部分。被外层遮住的部分与收在里面看不见的东西不要提，也不为了提到它去改写外形。

只写可见外观，不写心理、名字与规则；不要解释过程。完成后调用 submit_appearance 提交。`;

export type AppearanceUpdateInput = {
  inputMessage: string;
  form: string;
  worn: AppearanceWornItem[];
};

/** `update`：按形态与当前穿戴重新生成，不提供旧外观，免得模型复述旧值。 */
export function buildAppearanceUpdateInput(actor: ActorState): AppearanceUpdateInput {
  const worn = wornForAppearance(actor);
  const inputMessage = `# 外观更新

重新推理你此刻的可见外观。

## 形态

${actor.signature.form}

## 当前穿戴

${renderWorn(worn)}

# 本轮任务

写出此刻的可见外观：形态与穿戴，加上记忆里已经出现的可见变化，合成一段第三人称快照。

${VISIBILITY_RULES}`;
  return { inputMessage, form: actor.signature.form, worn };
}

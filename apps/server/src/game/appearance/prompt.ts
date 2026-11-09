import type { ToolDefinition } from "../../llm/types";
import { assertWorldFaceText } from "../addressing";
import { GameError } from "../errors";
import { equippedItems } from "../item-state";
import { type ActorState, type AppearanceWornItem, EQUIPMENT_SLOT_LABELS } from "../types";

/**
 * 外观推理的提示词与工具契约：工具形状、参数校验，以及这一轮要模型看什么。
 *
 * 与其余 agent 一样，这一份只依赖角色状态（形态、穿戴、变化简报），不碰数据库；
 * 回合怎么跑、结果怎么写库在 `turn.ts`。
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

/** 先提交“本次变化”的简报；不是终止工具，提交后继续生成最终外观。 */
export function buildSubmitAppearanceBriefTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_appearance_brief",
      description: "提交本次外观变化的第三人称简报。",
      parameters: {
        type: "object",
        properties: {
          brief: {
            type: "string",
            description: "一段第三人称可见变化，供随后生成最终外观参考",
          },
        },
        required: ["brief"],
      },
    },
  };
}

export function parseAppearanceBrief(
  args: Record<string, unknown>,
  actorNames: readonly string[] = [],
): string {
  const brief = typeof args.brief === "string" ? args.brief.trim() : "";
  if (brief.length === 0) {
    throw new GameError("invalid_action", "appearance brief 不能为空");
  }
  assertWorldFaceText(brief, actorNames, "appearance brief");
  return brief;
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

export type AppearanceBuildInput = {
  inputMessage: string;
  context: {
    form: string;
    dead: boolean;
    worn: AppearanceWornItem[];
  };
};

export function buildAppearanceTurnInput(
  actor: ActorState,
  dead = false,
  brief?: string,
  requestBrief = false,
): AppearanceBuildInput {
  // 饰品不参与外观推理：这个大类在不同题材里语义漂移（它也可能指与外观无关的植入物），
  // 引擎只保留槽位与穿戴索引，外观只消费衣物与武器。见 docs/data-driven.md。
  const worn = equippedItems(actor).filter(({ slot }) => slot !== "accessory");
  const wornLines =
    worn.length === 0
      ? "无"
      : worn
          .map(
            ({ slot, item }) =>
              `- ${EQUIPMENT_SLOT_LABELS[slot]}：${item.name}（${item.kind}）：${item.description}`,
          )
          .join("\n");
  const wornSnapshot = worn.map(({ slot, item }) => ({
    slot,
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    description: item.description,
  }));

  const task = dead
    ? `角色已经倒下（当前生命 0）。写一段尸体外观快照：姿势、伤口、血迹、衣物与装备的错位、周围的痕迹。
记忆里若有可见的变化与痕迹，把它们写进尸体状态；仍不写动作、心理或后续，不把死亡写成原因，也不复述数值。`
    : `结合你的记忆（伤势、血迹、灰尘、姿态、最近发生的事，以及记忆里出现的可见变化），把形态、当前穿戴与自身润色融合成一段第三人称外观快照。`;

  const inputMessage = `# 外观更新

你要为${actor.name}重新推理“当前可见外观”。

## 形态

${actor.signature.form}

## 当前穿戴

${wornLines}
${brief ? `\n## 本次变化\n\n${brief}\n\n以下是本次事件已经确认的可见变化，作为参考；与形态、穿戴和记忆冲突时以事实为准，不要机械照抄。` : ""}
${requestBrief && !brief ? `\n## 生成步骤\n\n先调用 submit_appearance_brief，用一小段第三人称可见事实写下本次变化（死因、伤口、可见损伤、姿势、衣物与装备的错位等）；然后再调用 submit_appearance 提交最终外观。简报只写可见结果，不写最终外观全文。` : ""}

# 本轮任务

${task}

只使用上面列出的穿戴；未列出的衣物与装备不存在，不要虚构。形态描述里没有写到的衣物视为没有穿上。不要改写种族与身体特征。

穿戴不等于露出：只写从外面能看见的部分。被衣物、斗篷或绷带遮住的贴身物件与藏在衣兜里的东西不要提，也不为了提到它去改写衣着。

只写可见外观，不写心理、名字与规则；不要解释过程。完成后调用 submit_appearance 提交。`;

  return {
    inputMessage,
    context: { form: actor.signature.form, dead, worn: wornSnapshot },
  };
}

/** stage 回合的工具契约：仲裁动作与它们的解析器。
 *
 * 这里只管形状与就地校验；语义（锚点是否重复、通道是否存在）在 `arbitrate.ts`
 * 落账时统一校验，免得同一套规则写两遍。装配见 `./toolkit.ts`，编排见 `./prompt.ts`。
 */

import type { ToolDefinition } from "../../../llm/types";
import { GameError } from "../../errors";
import type { StageAction } from "../../kernel/types";

/*
 * stage 对 actor 的只读 inspect 已停用：stage 对本舞台的携带物本来就全知，只搬一份
 * 物品清单没有业务用处；而它真正缺的 stats 与存活状态偏偏没给——看得到的和想看的
 * 正好错开。要恢复时别只搬物品清单：把 `describeStats` 一起带上，并想清楚它和
 * actor 自己的 `inspect`（占一次行动、留痕看敏捷）差在哪。
 */

export function buildSubmitEnvironmentTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_environment",
      description:
        "提交本舞台 environment 的完整快照；它是普通写动作，不结束本轮。没有变化就不要调用。",
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description:
              "更新后的完整 environment 快照；只写此刻可被观察到的状态，不含角色名、角色行动、编号引用（#编号），也不要点名还没打通的通道对面是哪里。",
          },
        },
        required: ["environment"],
      },
    },
  };
}

export function parseEnvironment(args: Record<string, unknown>): string | undefined {
  const environment = typeof args.environment === "string" ? args.environment.trim() : "";
  return environment.length > 0 ? environment : undefined;
}

/** 终结工具：把本轮已暂存的动作交出去；空计划表示本轮无改动。 */
export function buildSubmitStagePlanTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_stage_plan",
      description: "提交本轮已暂存的动作并结束；没有动作时提交空计划。按加入顺序执行。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

export function buildAddAnchorTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "add_anchor",
      description:
        "新增一个可交互锚点；标签舞台内唯一，描述可选。锚点只是可供性，不承载效果与后果。",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "锚点短标签" },
          description: { type: "string", description: "可选的可观察细节" },
        },
        required: ["label"],
      },
    },
  };
}

export function buildRemoveAnchorTool(availableAnchors: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "remove_anchor",
      description: "移除一个可交互锚点；它上面的物品会一起移除。",
      parameters: {
        type: "object",
        properties: {
          targetAnchor: {
            type: "string",
            description: "要移除的锚点标签",
            ...(availableAnchors.length > 0 ? { enum: [...availableAnchors] } : {}),
          },
        },
        required: ["targetAnchor"],
      },
    },
  };
}

export function buildUpdateAnchorTool(availableAnchors: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "update_anchor",
      description:
        "改写一个可交互锚点：提交它的完整文本，省略 description 表示没有描述；改标签不影响挂在上面的物品。",
      parameters: {
        type: "object",
        properties: {
          targetAnchor: {
            type: "string",
            description: "要改写的锚点当前标签",
            ...(availableAnchors.length > 0 ? { enum: [...availableAnchors] } : {}),
          },
          label: { type: "string", description: "改写后的标签" },
          description: { type: "string", description: "改写后的可观察细节；省略表示没有描述" },
        },
        required: ["targetAnchor", "label"],
      },
    },
  };
}

/** 解析新增锚点；文本语义在 applyStagePlan 里统一校验。 */
export function parseAddAnchor(args: Record<string, unknown>): StageAction {
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (label.length === 0) {
    throw new GameError("invalid_action", "add_anchor 需要非空 label");
  }
  const description = typeof args.description === "string" ? args.description.trim() : "";
  return {
    kind: "add_anchor",
    label,
    ...(description.length > 0 ? { description } : {}),
  };
}

export function parseRemoveAnchor(args: Record<string, unknown>): StageAction {
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  if (targetAnchor.length === 0) {
    throw new GameError("invalid_action", "remove_anchor 需要非空 targetAnchor");
  }
  return { kind: "remove_anchor", targetAnchor };
}

export function parseUpdateAnchor(args: Record<string, unknown>): StageAction {
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (targetAnchor.length === 0) {
    throw new GameError("invalid_action", "update_anchor 需要非空 targetAnchor");
  }
  if (label.length === 0) {
    throw new GameError("invalid_action", "update_anchor 需要非空 label");
  }
  const description = typeof args.description === "string" ? args.description.trim() : "";
  return {
    kind: "update_anchor",
    targetAnchor,
    label,
    ...(description.length > 0 ? { description } : {}),
  };
}

/** 把一条需要世界知晓的舞台报告加入本轮计划。 */
export function buildNotifyWorldTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_world",
      description: `把一条需要世界知晓的舞台报告加入本轮计划。报告只写本舞台已发生的事实与需要裁决的问题，不写裁决、结论与后果；状态描述、担忧与请求知情都不是事实，不要报。`,
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "发给世界的舞台报告。",
          },
        },
        required: ["content"],
      },
    },
  };
}

export function parseWorldNotification(args: Record<string, unknown>): string {
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (content.length === 0) {
    throw new GameError("invalid_action", "notify_world 需要非空 content");
  }
  return content;
}

/** 候选只含本舞台已声明、仍未开启的邻边。 */
export function buildOpenPassageTool(sealedStageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "open_passage",
      description: `把本舞台通往某个尚未开启的相邻舞台的通道打开，加入本轮计划。`,
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "要打开通道的相邻舞台名；只能从尚未开启的通道中选择",
            ...(sealedStageNames.length > 0 ? { enum: [...sealedStageNames] } : {}),
          },
        },
        required: ["targetStageName"],
      },
    },
  };
}

export function parseOpenPassage(args: Record<string, unknown>): StageAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "open_passage 需要非空 targetStageName");
  }
  return { kind: "open_passage", targetStageName };
}

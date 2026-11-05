import type { ToolDefinition } from "../../llm/types";
import { MAX_STAGE_ANCHORS } from "../constants";
import { GameError } from "../errors";
import type { StageAction, StageAnchor } from "../types";

export function buildSubmitEnvironmentTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_environment",
      description: `提交 environment 与 anchors 的完整快照，并结束本轮仲裁；两者都是快照，不是差异。`,
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description:
              "更新后的完整 environment 快照；只写此刻可被观察到的状态，不含角色名、角色行动与编号引用（#编号）；省略表示本轮不修改。",
          },
          anchors: {
            type: "array",
            description: `完整锚点快照；最多 ${MAX_STAGE_ANCHORS} 个，标签场景内唯一；省略表示不修改，空数组表示全部移除。只列角色此刻能直接作用的点：装饰、氛围与通向别处的路径都不是锚点，也不写效果与后果。`,
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "锚点短标签",
                },
                description: {
                  type: "string",
                  description: "可选的可观察细节",
                },
              },
              required: ["label"],
            },
          },
        },
        required: [],
      },
    },
  };
}

export function parseEnvironment(args: Record<string, unknown>): string | undefined {
  const environment = typeof args.environment === "string" ? args.environment.trim() : "";
  return environment.length > 0 ? environment : undefined;
}

/** 解析 stage 提交的锚点快照；结构错误在这里拦住，内容语义在 applyStagePlan 里校验。 */
export function parseAnchors(args: Record<string, unknown>): StageAnchor[] | undefined {
  if (args.anchors === undefined) {
    return undefined;
  }
  if (!Array.isArray(args.anchors)) {
    throw new GameError("invalid_action", "anchors 必须是数组");
  }
  return args.anchors.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new GameError("invalid_action", "anchors 的每一项必须是对象");
    }
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (label.length === 0) {
      throw new GameError("invalid_action", "锚点 label 不能为空");
    }
    const description = typeof raw.description === "string" ? raw.description.trim() : undefined;
    return {
      label,
      ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
  });
}

/** 把一条需要世界知晓的场景报告加入本轮计划。 */
export function buildNotifyWorldTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_world",
      description: `把一条需要世界知晓的场景报告加入本轮计划。报告只写本场景已发生的事实与需要裁决的问题，不写裁决、结论与后果；状态描述、担忧与请求知情都不是事实，不要报。`,
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "发给世界的场景报告。",
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

/** 候选只含本场景已声明、仍未开启的邻边。 */
export function buildOpenPassageTool(sealedStageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "open_passage",
      description: `把本场景通往某个尚未开启的相邻场景的通道打开，加入本轮计划。`,
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "要打开通道的相邻场景名；只能从尚未开启的通道中选择",
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

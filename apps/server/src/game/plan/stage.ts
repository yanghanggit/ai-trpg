import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import type { StageAction } from "../types";

export function buildSubmitEnvironmentTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_environment",
      description:
        "提交本场景 environment 的完整快照；它是普通写动作，不结束本轮。没有变化就不要调用。",
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description:
              "更新后的完整 environment 快照；只写此刻可被观察到的状态，不含角色名、角色行动与编号引用（#编号）。",
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

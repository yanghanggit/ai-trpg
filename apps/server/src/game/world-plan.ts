import type { ToolDefinition } from "../llm/types";
import { MAX_WORLD_DIRECTIVE_LENGTH } from "./constants";
import { GameError } from "./errors";
import type { WorldAction } from "./types";

/** 构造 world 向 stage 下发裁决的工具。 */
export function buildNotifyStageTool(stageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_stage",
      description:
        "把一条世界裁决或世界级变化下发给指定场景，写入该场景 memory，供其下一回合读取。它不直接修改场景 environment。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            description: "接收世界裁决的场景",
            ...(stageNames.length > 0 ? { enum: [...stageNames] } : {}),
          },
          content: {
            type: "string",
            description: "世界裁决或跨场景变化；写清楚场景应知道什么，不要替场景写具体环境快照",
          },
        },
        required: ["stageName", "content"],
      },
    },
  };
}

/** 解析 notify_stage。 */
export function parseNotifyStage(args: Record<string, unknown>): WorldAction {
  const stageName = typeof args.stageName === "string" ? args.stageName.trim() : "";
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (stageName.length === 0 || content.length === 0) {
    throw new GameError("invalid_action", "notify_stage 需要非空 stageName 与 content");
  }
  if (content.length > MAX_WORLD_DIRECTIVE_LENGTH) {
    throw new GameError(
      "invalid_action",
      `notify_stage 的 content 不能超过 ${MAX_WORLD_DIRECTIVE_LENGTH} 个字符`,
    );
  }
  return { kind: "notify_stage", stageName, content };
}

/** 构造 world 结束游戏的工具；这是唯一允许结束游戏的入口。 */
export function buildEndGameTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "end_game",
      description:
        "结束整局游戏。只有 world 拥有此能力；必须提供世界内可见的结束文案。end_game 必须是本轮最后一个动作。",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "世界内可见的结束文案，说明故事如何收束",
          },
        },
        required: ["message"],
      },
    },
  };
}

/** 解析 end_game。 */
export function parseEndGame(args: Record<string, unknown>): WorldAction {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (message.length === 0) {
    throw new GameError("invalid_action", "end_game 需要非空 message");
  }
  return { kind: "end_game", message };
}

/** 构造 world 的终止工具。 */
export function buildSubmitWorldPlanTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_world_plan",
      description:
        "提交本轮 world 计划并结束。计划按加入顺序执行；end_game 必须是最后一条。没有动作时不要提交。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

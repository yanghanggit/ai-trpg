import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import type { GameStateSlice, WorldAction } from "../types";

export function buildLookTool(state: GameStateSlice): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description:
        "查看当前世界中某个场景的设定、环境、角色、可交互锚点及其上的物品与可去方向。只读，可多次调用。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            enum: state.world.stages.map((stage) => stage.name),
            description: "要查看的场景名",
          },
        },
        required: ["stageName"],
      },
    },
  };
}

/** 构造 world 向 stage 下发裁决的工具。 */
export function buildNotifyStageTool(stageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_stage",
      description:
        "把一条世界裁决或世界级变化下发给指定场景，写入该场景 memory，供其下一回合读取。",
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
            description: "世界裁决或跨场景变化；写清楚场景应知道什么。",
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
  return { kind: "notify_stage", stageName, content };
}

/** 构造 world 结束游戏的工具；这是唯一允许结束游戏的入口。 */
export function buildEndGameTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "end_game",
      description: "结束整局游戏；必须给出结局标签与世界内可见的结束文案。",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            description: "结局标签：一个简短词语，只用于记录，不进入叙事。",
          },
          message: {
            type: "string",
            description: "世界内可见的结束文案，只收束已经发生的事实，不替场景补写细节",
          },
        },
        required: ["outcome", "message"],
      },
    },
  };
}

/** 解析 end_game；`outcome` 是 world 自己命名的短标签。 */
export function parseEndGame(args: Record<string, unknown>): WorldAction {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  const outcome = typeof args.outcome === "string" ? args.outcome.trim() : "";
  if (message.length === 0) {
    throw new GameError("invalid_action", "end_game 需要非空 message");
  }
  if (outcome.length === 0) {
    throw new GameError("invalid_action", "end_game 需要非空 outcome");
  }
  return { kind: "end_game", message, outcome };
}

/** 构造 world 的终止工具。 */
export function buildSubmitWorldPlanTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_world_plan",
      description: "提交本轮 world 计划并结束。计划按加入的顺序执行。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

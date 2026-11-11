/**
 * world 裁决动作的工具契约：模型看得见的形状 + 把参数变回 `WorldAction` 的解析器。
 *
 * 只读的 look_stage 也在这里，连同它读出来的舞台文本：world 是 god view，读任意舞台的
 * 完整视图（含 profile 与 environment），不按观察者脱敏。落账见 `./arbitrate.ts`，
 * 编排见 `./prompt.ts`。
 */

import type { ToolDefinition } from "../../../llm/types";
import { GameError } from "../../errors";
import type { GameStateSlice, WorldAction } from "../../kernel/types";
import { isAlive } from "../../lookup";
import { adjacentStageNames, findStageByName } from "../../stage-state";
import { describeStageAnchorsSection } from "../../stage-state/describe";

export function buildWorldLookStageTool(state: GameStateSlice): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description:
        "查看当前世界中某个舞台的设定、环境、角色、可交互锚点及其上的道具与可去方向。只读，可多次调用。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            enum: state.world.stages.map((stage) => stage.name),
            description: "要查看的舞台名",
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
        "把一条世界裁决或世界级变化下发给指定舞台，写入该舞台 memory，供其下一回合读取。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            description: "接收世界裁决的舞台",
            ...(stageNames.length > 0 ? { enum: [...stageNames] } : {}),
          },
          content: {
            type: "string",
            description: "世界裁决或跨舞台变化；写清楚舞台应知道什么。",
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
            description: "世界内可见的结束文案，只收束已经发生的事实，不替舞台补写细节",
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

/** world 视角：可查看任意舞台，名字与 environment 原样输出。 */
export function describeStageForWorld(state: GameStateSlice, stageName: string): string {
  const stage = findStageByName(state, stageName);
  if (!stage) {
    return `错误：舞台不存在 ${stageName}`;
  }
  const moves = adjacentStageNames(state, stage.id);
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => `${actor.name}${isAlive(actor) ? "" : "（已死亡）"}`)
          .join("、");
  return `舞台：${stage.name}
${stage.profile}
${stage.environment}
角色：${actors}
${describeStageAnchorsSection(stage.anchors)}
可去：${moves.length === 0 ? "无" : moves.join("、")}`;
}

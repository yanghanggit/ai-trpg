import type { ToolDefinition } from "../llm/types";
import {
  ACTION_DEFINITIONS,
  ACTOR_ACTION_TYPES,
  isActorActionType,
  MAX_MIND_LENGTH,
} from "./actions";
import { adjacentStageNames, findStageByName } from "./actors";
import { GameError } from "./errors";
import type { ActorActionPlan, GameState } from "./types";

/** 构造只读环境查看工具。 */
export function buildLookTool(state: GameState): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description: "查看当前世界中某个场景的环境、角色与可去方向。只读，可多次调用。",
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

/** 构造终止工具；它只收集计划，不直接修改游戏状态。 */
export function buildSubmitPlanTool(
  availableStageNames: readonly string[],
  availableTargetActorNames: readonly string[],
): ToolDefinition {
  const targetStageSchema: Record<string, unknown> = {
    type: "string",
    description: "move 时必填：目标场景名",
    ...(availableStageNames.length > 0 ? { enum: availableStageNames } : {}),
  };
  const targetActorSchema: Record<string, unknown> = {
    type: "string",
    description:
      "say/whisper 时必填：当前场景内唯一的说话对象；announce/wait/move 时传空字符串。计划提交后由服务端校验。",
    ...(availableTargetActorNames.length > 0 ? { enum: availableTargetActorNames } : {}),
  };
  const actionDescription = ACTOR_ACTION_TYPES.map(
    (action) => `${action}=${ACTION_DEFINITIONS[action].description}`,
  ).join("；");

  return {
    type: "function",
    function: {
      name: "submit_action_plan",
      description: "提交本轮 actor 行动决策；调用后本轮规划结束。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: `第一人称内心独白，控制在 ${MAX_MIND_LENGTH} 字以内`,
          },
          actionType: {
            type: "string",
            enum: [...ACTOR_ACTION_TYPES],
            description: actionDescription,
          },
          targetStageName: targetStageSchema,
          targetActorName: targetActorSchema,
          message: {
            type: "string",
            description: "say/whisper/announce 时必填：你要说出的内容；wait/move 留空。",
          },
        },
        required: ["mind", "actionType", "targetActorName"],
      },
    },
  };
}

/** 读取某个场景的公开信息，供 look_stage 工具返回。 */
export function lookStage(state: GameState, stageName: string): string {
  const stage = findStageByName(state, stageName);
  if (!stage) {
    return `错误：场景不存在 ${stageName}`;
  }
  const moves = adjacentStageNames(state, stage.id);
  return [
    `场景：${stage.name}`,
    stage.environment,
    stage.narrative,
    `角色：${stage.actors.length === 0 ? "无" : stage.actors.map((actor) => actor.name).join("、")}`,
    `可去：${moves.length === 0 ? "无" : moves.join("、")}`,
  ].join("\n");
}

/** 把终止工具参数转换为行动计划；只检查形状，不校验游戏状态。 */
export function parsePlan(args: Record<string, unknown>): ActorActionPlan {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const actionType = args.actionType;
  if (!isActorActionType(actionType)) {
    throw new GameError("invalid_action", `非法 actionType: ${String(actionType)}`);
  }
  return {
    mind,
    actionType,
    ...(typeof args.targetStageName === "string" ? { targetStageName: args.targetStageName } : {}),
    ...(typeof args.targetActorName === "string"
      ? { targetActorName: args.targetActorName.trim() }
      : {}),
    ...(typeof args.message === "string" ? { message: args.message } : {}),
  };
}

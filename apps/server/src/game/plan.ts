import type { ToolDefinition } from "../llm/types";
import { adjacentStageNames, findStageByName } from "./actors";
import { GameError } from "./errors";
import type { ActorState, GameState } from "./types";

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

/** 构造 stage 小 GM 的只读场景查看工具；只允许查看本场景。 */
export function buildStageLookTool(stageName: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description: "查看本场景的当前环境、角色与场景物品。只读。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            enum: [stageName],
            description: "本场景名称",
          },
        },
        required: ["stageName"],
      },
    },
  };
}

/** 构造自身 stats 查看工具；只读，可在需要时多次调用。 */
export function buildStatsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_stats",
      description: "查看自己的当前 stats：HP、attack、defense、speed 与存活状态。只读。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 构造自身物品查看工具；只读，可在需要时多次调用。 */
export function buildItemsTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_items",
      description: "查看自己持有的物品及其描述。只读。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 构造感知工具；读取同场景目标角色的 stats、状态与背包。 */
export function buildActorInfoTool(availableTargetActorNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_actor",
      description: "查看同场景目标角色的 stats 与持有的物品。只读。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            enum: availableTargetActorNames,
            description: "要查看的同场景角色名",
          },
        },
        required: ["targetActorName"],
      },
    },
  };
}

/** 构造终止工具；调用后本轮计划结束。 */
export function buildSubmitPlanTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_plan",
      description: "提交本轮已暂存的行动计划；调用后本轮规划结束。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 构造 stage 小 GM 的环境提交终止工具。 */
export function buildSubmitEnvironmentTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_environment",
      description: "提交本场景更新后的 environment；调用后本轮仲裁结束。",
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description: "更新后的完整环境快照；不得包含角色名称、角色行动或角色状态",
          },
        },
        required: ["environment"],
      },
    },
  };
}

/** 把 submit_environment 工具参数转换为 StagePlan；只检查形状。 */
export function parseEnvironment(args: Record<string, unknown>): string {
  const environment = typeof args.environment === "string" ? args.environment.trim() : "";
  if (environment.length === 0) {
    throw new GameError("invalid_action", "environment 不能为空");
  }
  return environment;
}

/** 渲染自身 stats，供 get_stats 工具返回。 */
export function describeStats(actor: ActorState): string {
  return [
    `角色：${actor.name}`,
    `HP：${actor.hp}/${actor.maxHp}`,
    `attack：${actor.attack}`,
    `defense：${actor.defense}`,
    `speed：${actor.speed}`,
    `状态：${actor.death ? "已死亡" : "存活"}`,
  ].join("\n");
}

/** 渲染自身物品，供 get_items 工具返回。 */
export function describeItems(actor: Pick<ActorState, "items">): string {
  if (actor.items.length === 0) {
    return "物品：无";
  }
  return [
    "物品：",
    ...actor.items.map((item) => {
      const stats =
        item.damage > 0 || item.block > 0 ? `（damage ${item.damage}，block ${item.block}）` : "";
      return `- ${item.name}（${item.kind}，count ${item.count}）：${item.description}${stats}`;
    }),
  ].join("\n");
}

/** 渲染同场景目标角色，供 get_actor 工具返回。 */
export function describeActor(actor: ActorState): string {
  return [describeStats(actor), describeItems(actor)].join("\n");
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
    `角色：${stage.actors.length === 0 ? "无" : stage.actors.map((actor) => `${actor.name}${actor.death ? "（已死亡）" : ""}`).join("、")}`,
    `物品：${stage.items.length === 0 ? "无" : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("；")}`,
    `可去：${moves.length === 0 ? "无" : moves.join("、")}`,
  ].join("\n");
}

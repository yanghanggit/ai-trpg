import type { ToolDefinition } from "../llm/types";
import { adjacentStageNames, findStageByName } from "./actors";
import { attribute } from "./attributes";
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

/** 构造 stage 小 GM 的环境提交终止工具；环境写法规则放在工具描述里。 */
export function buildSubmitEnvironmentTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_environment",
      description: `提交本场景更新后的 environment，并结束本轮仲裁。

environment 是场景当前的身体状态：只描述此刻可以直接观察到的环境、物体、表面、光线、气味与氛围。
- 必须与当前场景物品一致：仍在场景中的物品要写；不在场景中的物品直接省略，不写它曾经存在、消失、被拿走，也不写它留下的空位、印子、痕迹、碎屑。
- 只写当前快照，不写历史、因果、变化过程，也不写对过去的推断。
- 不要使用“痕迹、渍痕、污渍、残留、碎屑、空位、印子、缺口、原来、曾经、留下、消失”等历史线索词。
- 不能包含角色名称、角色行动或角色状态；角色由场景状态单独承载。
- 不要替角色行动，不要修改角色属性、物品或位置。

提交的是完整快照，不是差异。`,
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description:
              "更新后的完整 environment 快照；只描述当前可观察状态，不含角色名称、角色行动与历史线索",
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
  return `角色：${actor.name}
HP：${actor.stats.hp}/${actor.stats.maxHp}
attack：${actor.stats.attack}
defense：${actor.stats.defense}
speed：${actor.stats.speed}
状态：${actor.status === "dead" ? "已死亡" : "存活"}`;
}

/** 渲染自身物品，供 get_items 工具返回。 */
export function describeItems(actor: Pick<ActorState, "items" | "equipment">): string {
  if (actor.items.length === 0) {
    return "物品：无";
  }
  const lines = actor.items.map((item) => {
    const itemStats = "stats" in item ? item.stats : undefined;
    const damage = attribute(itemStats, "damage");
    const block = attribute(itemStats, "block");
    const stats = damage > 0 || block > 0 ? `（damage ${damage}，block ${block}）` : "";
    const worn = Object.values(actor.equipment).includes(item.name) ? "，已穿戴" : "";
    return `- ${item.name}（${item.kind}，count ${item.count}${worn}）：${item.description}${stats}`;
  });
  return `物品：
${lines.join("\n")}`;
}

/** 渲染同场景目标角色，供 get_actor 工具返回。 */
export function describeActor(actor: ActorState): string {
  return `外观：${actor.appearance}
${describeStats(actor)}
${describeItems(actor)}`;
}

/** 读取某个场景的公开信息，供 look_stage 工具返回。 */
export function lookStage(state: GameState, stageName: string): string {
  const stage = findStageByName(state, stageName);
  if (!stage) {
    return `错误：场景不存在 ${stageName}`;
  }
  const moves = adjacentStageNames(state, stage.id);
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => `${actor.name}${actor.status === "dead" ? "（已死亡）" : ""}`)
          .join("、");
  const items =
    stage.items.length === 0
      ? "无"
      : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("；");
  return `场景：${stage.name}
${stage.environment}
角色：${actors}
物品：${items}
可去：${moves.length === 0 ? "无" : moves.join("、")}`;
}

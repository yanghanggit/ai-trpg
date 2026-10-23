import type { ToolDefinition } from "../llm/types";
import type { RagSearchResult } from "../rag";
import { adjacentStageNames, findStageByName } from "./actors";
import { attribute } from "./attributes";
import { GameError } from "./errors";
import type { ActorState, GameState } from "./types";
import { EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "./types";

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

/** 构造自身全信息查看工具；外观、stats、状态、穿戴与物品一次返回。 */
export function buildSelfInfoTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_self",
      description: "查看自己的外观、stats、存活状态、穿戴槽与全部物品。只读。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 构造对同场景目标的感知工具；只返回对方携带的物品，不暴露 stats 或状态。 */
export function buildObserveActorTool(
  availableTargetActorNames: readonly string[],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "observe_actor",
      description:
        "感知同场景目标角色携带的物品（含其穿戴），用于判断能否 steal；看不到对方的 stats 或存活状态。只读。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            enum: availableTargetActorNames,
            description: "要感知的同场景角色名",
          },
        },
        required: ["targetActorName"],
      },
    },
  };
}

/** 构造公共知识库检索工具；只对 actions 中显式列出 query 的角色暴露。 */
export function buildKnowledgeTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "query",
      description:
        "检索当前世界的公共知识库：建筑、地理、历史、瘟疫、习俗等任何人都可能观察或听说的事实。只读，可多次调用，不占行动。它不包含角色秘密、当前场景状态、物品位置或未公开剧情；检索结果不等于亲眼所见。",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "要查询的公共知识问题；用自然语言描述，不要询问角色秘密或当前状态",
          },
        },
        required: ["question"],
      },
    },
  };
}

/** 渲染知识库检索结果；相似度只是文本接近度，不是事实权威。 */
export function describeKnowledgeResults(
  question: string,
  results: readonly RagSearchResult[],
): string {
  if (results.length === 0) {
    return `# 公共知识检索
问题：${question}
（知识库中未检索到相关信息）`;
  }
  const lines = results.map(
    (result, index) => `${index + 1}. [相似度 ${result.similarity.toFixed(3)}] ${result.content}`,
  );
  return `# 公共知识检索
问题：${question}
${lines.join("\n")}

相似度仅表示文本接近程度；公共知识不等于你亲眼所见，也不能据此知道角色秘密或当前状态。`;
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

/** 渲染 stats，供自身信息与目标观察共用。 */
export function describeStats(actor: ActorState): string {
  return `角色：${actor.name}
HP：${actor.stats.hp}/${actor.stats.maxHp}
attack：${actor.stats.attack}
defense：${actor.stats.defense}
speed：${actor.stats.speed}
状态：${actor.status === "dead" ? "已死亡" : "存活"}`;
}

/** 渲染物品清单；穿戴状态由 actor 的槽位索引标记。 */
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

/** 渲染自己的穿戴槽。 */
export function describeEquipment(actor: Pick<ActorState, "equipment">): string {
  const lines = EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`- ${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  });
  return lines.length === 0 ? "穿戴：无" : `穿戴：\n${lines.join("\n")}`;
}

/** 渲染自己的全信息，供 get_self 工具返回。 */
export function describeSelf(actor: ActorState): string {
  return `外观：${actor.appearance}
${describeStats(actor)}
${describeEquipment(actor)}
${describeItems(actor)}`;
}

/** 渲染对目标的感知结果，只包含对方携带的物品，供 observe_actor 工具返回。 */
export function describeObservedActor(actor: ActorState): string {
  return `${actor.name}携带：
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

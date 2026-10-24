import type { ToolDefinition } from "../llm/types";
import type { RagSearchResult } from "../rag";
import { adjacentStageNames, findStageByName } from "./actors";
import { attribute } from "./attributes";
import { MAX_WORLD_NOTIFICATION_LENGTH } from "./constants";
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

/** 构造公共知识库检索工具；只对 canQuery 为真的角色暴露。 */
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
      description: `提交本轮场景计划并结束仲裁：可提交更新后的 environment，也可只提交已经通过 notify_world 记录的通知。

environment 是场景当前的身体状态：只描述此刻可以直接观察到的环境、物体、表面、光线、气味与氛围。
- 必须与当前场景物品一致：仍在场景中的物品要写；不在场景中的物品直接省略，不写它曾经存在、消失、被拿走，也不写它留下的空位、印子、痕迹、碎屑。
- 只写当前快照，不写历史、因果、变化过程，也不写对过去的推断。
- 不要使用“痕迹、渍痕、污渍、残留、碎屑、空位、印子、缺口、原来、曾经、留下、消失”等历史线索词。
- 不能包含角色名称、角色行动或角色状态；角色由场景状态单独承载。
- 不要替角色行动，不要修改角色属性、物品或位置。

提交的是完整快照，不是差异。environment 可省略，但本轮必须至少提交 environment 或 notify_world 通知。`,
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            description:
              "更新后的完整 environment 快照；只描述当前可观察状态，不含角色名称、角色行动与历史线索；省略表示不修改环境",
          },
        },
        required: [],
      },
    },
  };
}

/** 把 submit_environment 工具参数转换为 environment；省略时返回 undefined。 */
export function parseEnvironment(args: Record<string, unknown>): string | undefined {
  const environment = typeof args.environment === "string" ? args.environment.trim() : "";
  return environment.length > 0 ? environment : undefined;
}

/** 构造 stage 给 world 的通知工具；通知只是报告，不是世界事实。 */
export function buildNotifyWorldTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_world",
      description: `把一条需要世界知晓的场景报告加入本轮计划，然后继续提交 environment 或直接提交计划。

只用于跨场景/世界级后果、会改变其他场景的行动，或需要世界裁决的世界级事实。只有场景已有信息表明 targetDetail 是功能部位（如锁孔、门闩、机关），并且行动可能改变通行/封闭或跨场景状态时，才在结果不确定时通知。装饰、铭文、表面纹样、物品外观相似不构成机关，不能据此推测隐藏锁扣；普通触摸、敲击、查看、试探、在表面留下痕迹时不要调用本工具。
通知是场景观察与请求，不是既成事实；写清发生了什么、涉及哪个场景/物品/角色，以及需要世界裁决什么。不要写成系统指令。`,
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "发给世界的场景报告；只描述本场景可观察到的行动与需要裁决的问题",
          },
        },
        required: ["content"],
      },
    },
  };
}

/** 解析 notify_world 参数。 */
export function parseWorldNotification(args: Record<string, unknown>): string {
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (content.length === 0) {
    throw new GameError("invalid_action", "notify_world 需要非空 content");
  }
  if (content.length > MAX_WORLD_NOTIFICATION_LENGTH) {
    throw new GameError(
      "invalid_action",
      `notify_world 的 content 不能超过 ${MAX_WORLD_NOTIFICATION_LENGTH} 个字符`,
    );
  }
  return content;
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

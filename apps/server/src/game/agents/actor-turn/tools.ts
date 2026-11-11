/**
 * actor 回合的工具契约：只读查看、称呼与提交，以及它们各自的解析器与结果渲染。
 *
 * 与 stage / world 的 `tools.ts` 同层：这里只管模型看得见的形状、就地校验，
 * 以及该工具把自己读到的东西渲染成什么文本。动作工具不在这里——它们与玩家入口
 * 共用，留在 `actions/*`；装配见 `./toolkit.ts`，编排见 `./prompt.ts`。
 */

import type { ToolDefinition } from "../../../llm/types";
import type { RagSearchResult } from "../../../rag";
import {
  type ActorWithStage,
  visitedStagesForActor,
  visitedTeleportTargetsFor,
} from "../../actor-state";
import { GameError } from "../../errors";
import {
  describeEquipment,
  describeEquipmentBrief,
  describeItems,
} from "../../item-state/describe";
import { addressLookupFor, parseHandle, parseSignatureName, refOf } from "../../kernel/addressing";
import { STAT_LABELS } from "../../kernel/attributes";
import type { ActorState, GameStateSlice } from "../../kernel/types";
import { isAlive } from "../../lookup";
import type { RouteQuestion } from "../../route";
import { describeStageAnchorsSection } from "../../stage-state/describe";
import {
  adjacentStageRefsForActor,
  renderStageEnvironmentForActor,
  sealedVisitedStageRefsForActor,
} from "./observed-stage";

export function buildSelfInfoTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_self",
      description:
        "查看自己的外观、stats、存活状态、穿戴槽与全部物品。stats 的字段是 strength / agility / wisdom / damage / block，依次对应力量 / 敏捷 / 智慧 / 伤害 / 格挡；伤害与力量一起构成挥击与横扫的攻击力，格挡构成防御，敏捷决定查看与窃取是否被察觉、窃取能否得手。数值是结算的输入，不是面板上限。只读。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 只读工具，不占动作名额。 */
export function buildKnowledgeTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "query",
      description:
        "检索当前世界的公共知识库：任何进入该世界的人都可能知道的固定事实。公共事实由它供给，不由角色编造；推断、意见与猜测仍是扮演的合法部分。只读，可多次调用，不占行动。",
      parameters: {
        type: "object",
        properties: {
          keywords: {
            type: "string",
            description:
              "检索关键词：2～4 个名词或短语，空格分隔；不要写整句提问，也不要询问角色秘密或当前状态",
          },
        },
        required: ["keywords"],
      },
    },
  };
}

export function describeKnowledgeResults(
  keywords: string,
  results: readonly RagSearchResult[],
): string {
  if (results.length === 0) {
    return `# 公共知识检索
检索词：${keywords}
（知识库中未检索到相关信息）`;
  }
  // 分类来自入库时写下的 metadata.category：它是结构信息，模型用它组织回答；
  // 相似度不写进文本——它只是余弦距离，模型容易读成置信度。
  const lines = results.map((result, index) => {
    const { category } = result.metadata;
    const label = typeof category === "string" && category.length > 0 ? `（${category}）` : "";
    return `${index + 1}. ${label}${result.content}`;
  });
  return `# 公共知识检索
检索词：${keywords}
${lines.join("\n")}

检索结果只是文本参考资料；公共知识不等于你亲眼所见，也不能据此知道角色秘密或当前状态。`;
}

/** 只读：让 NPC 回看自己去过的场景，不占行动。 */
export function buildVisitedStagesTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_visited_stages",
      description: "查看你去过的场景（含当前场景）。只读，不占行动。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

export function buildSubmitPlanTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_plan",
      description: "提交本轮已暂存的行动与认知更新；调用后本轮规划结束。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/**
 * actor 只能看自己所在的场景：工具不接受场景名，视野由回合状态决定。
 *
 * 参数化场景名时，模型可以点名别的场景；这里直接把入口收窄到当前场景。
 */
export function buildActorLookTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description:
        "重新查看你所在场景的环境、在场角色、可交互锚点及其上的物品与可去方向。只读，可多次调用。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/**
 * 记下一个签名的当前名字。
 *
 * 名字是观察者的认知，不要求是真名；同一个编号再次调用会覆盖旧名字。
 * 它只改自己的记忆，不产生公共事件，也不占行动名额。
 */
export function buildRecognizeIdentityTool(handles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "recognize_identity",
      description: `把某个编号记成你认得的名字。

同一个编号再次记录会覆盖旧名字；一轮里可以记多个。它只写进你自己的记忆，不占行动名额。`,
      parameters: {
        type: "object",
        properties: {
          handle: {
            type: "string",
            description: "对方的匿名编号，例如 #12",
            ...(handles.length > 0 ? { enum: [...handles] } : {}),
          },
          name: {
            type: "string",
            description: "你想怎么称呼对方；用一小段，不必是真名",
          },
        },
        required: ["handle", "name"],
      },
    },
  };
}

/**
 * 回忆从 A 到 B 怎么走。
 *
 * 只读，但结论会在计划落账时写进自己的记忆，所以它不是纯粹的查询工具。
 * 端点只要求是能解析到的真名，不要求去过：地名写错时整次回忆记为「无法寻路」。
 * 候选不做成 enum——地名可以来自任何地方，服务端按名字解析，解析不到就是一次失败。
 */
export function buildRecallRouteTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "recall_route",
      description: `回忆从 A 到 B 怎么走，结论会写进你自己的记忆（不占行动名额）。

起点与终点都写场景真名，不能用 #序号（#序号 只是路上看得见、还没命名的站位）；中间站可以是不认识的地方，会写成 #序号。能走通就给整条路线；走不通时把断处标成 →[封着]→，可能给出多条。地名写错（没有这个场景）时，这次回忆会被记成「无法寻路」。`,
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "起点场景名；省略表示你当前所在的场景。不接受 #序号",
          },
          to: { type: "string", description: "终点场景名。不接受 #序号" },
        },
        required: ["to"],
      },
    },
  };
}

export function parseRecallRoute(args: Record<string, unknown>): RouteQuestion {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  if (to.length === 0) {
    throw new GameError("invalid_action", "recall_route 需要非空 to");
  }
  const from = typeof args.from === "string" ? args.from.trim() : "";
  return { ...(from.length > 0 ? { fromStageRef: from } : {}), toStageRef: to };
}

export function parseRecognizeIdentity(args: Record<string, unknown>): {
  handle: string;
  name: string;
} {
  const handle = typeof args.handle === "string" ? args.handle.trim() : "";
  if (parseHandle(handle) === null) {
    throw new GameError("invalid_action", "handle 必须是匿名编号，例如 #12");
  }
  return { handle, name: parseSignatureName(args.name) };
}

/**
 * 只列参与结算的属性，免得模型据此推断出不存在的机制。
 *
 * 渲染统一用中文名：字段名与中文的对应只在工具契约里说一次，这里不再中英混排。
 * 力量进攻击力、敏捷管察觉与窃取成败，智慧没有读取点，所以不给它一行。
 */
export function describeStats(actor: ActorState): string {
  return `角色：${actor.name}
HP：${actor.hp}/${actor.stats.maxHp}
${STAT_LABELS.strength}：${actor.stats.strength}
${STAT_LABELS.agility}：${actor.stats.agility}
${STAT_LABELS.damage}：${actor.stats.damage}
${STAT_LABELS.block}：${actor.stats.block}
状态：${isAlive(actor) ? "存活" : "已死亡"}`;
}

export function describeSelf(actor: ActorState): string {
  return `外观：${actor.appearance.text}
${describeStats(actor)}
${describeEquipment(actor)}
${describeItems(actor)}`;
}

/** actor 视角的场景视图：只读当前场景，名字走观察者相对的引用。 */
export function describeStageForActor(state: GameStateSlice, current: ActorWithStage): string {
  const stage = current.stage;
  const address = addressLookupFor(state, current.actor, stage);
  const moves = adjacentStageRefsForActor(state, current);
  const remembered = sealedVisitedStageRefsForActor(state, current);
  const canTeleport = current.actor.actions.includes("teleport");
  const teleportLines = visitedTeleportTargetsFor(state, current.actor, stage)
    .map((candidate) => candidate.name)
    .join("、");
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => {
            const worn = describeEquipmentBrief(actor);
            const dead = isAlive(actor) ? "" : "（已死亡）";
            return `${refOf(address(actor.id))}${dead}${worn.length === 0 ? "" : `｜${worn}`}`;
          })
          .join("、");
  return `场景：${stage.name}
${renderStageEnvironmentForActor(state, current)}
角色：${actors}
${describeStageAnchorsSection(stage.anchors)}
可去：${moves.length === 0 ? "无" : moves.join("、")}${
    remembered.length === 0 ? "" : `\n记得封着：${remembered.join("、")}`
  }${
    canTeleport
      ? `
可传送（写对真名即可；下列是去过的、未禁传）：${teleportLines.length === 0 ? "无" : teleportLines}`
      : ""
  }`;
}

/**
 * 任务提示词里「读」那一步要列出的只读工具，顺序即提示词的顺序。
 *
 * 名字从工具定义取，不手抄一份：改名只改 `function.name`，提示词自动跟随。
 * 新增只读工具时加进这个数组：`prompt.ts` 的「读」那一步与用例都读它。
 */
export const ACTOR_READ_ONLY_TOOL_NAMES: readonly string[] = [
  buildActorLookTool(),
  buildSelfInfoTool(),
  buildVisitedStagesTool(),
  buildRecallRouteTool(),
  buildKnowledgeTool(),
  buildRecognizeIdentityTool([]),
].map((tool) => tool.function.name);

/**
 * 去过哪些场景。顺序直接沿用 `state.visits`（并列时已按场景序号兜底），
 * 这里不再重排，避开两处排序规则漂移。
 */
export function describeVisitedStages(
  state: GameStateSlice,
  actorId: string,
  currentStageId?: string,
): string {
  const visited = visitedStagesForActor(state, actorId);
  const lines =
    visited.length === 0
      ? "无"
      : visited
          .map((stage) => `${stage.name}${stage.id === currentStageId ? "（当前）" : ""}`)
          .join("\n");
  return `# 你去过的场景
${lines}`;
}

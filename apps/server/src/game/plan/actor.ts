import type { ToolDefinition } from "../../llm/types";
import type { RagSearchResult } from "../../rag";
import { GameError } from "../errors";
import { NAME_MARKER_PATTERN, parseHandle } from "../reference";
import type { RouteQuestion } from "../route";

export function buildSelfInfoTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_self",
      description:
        "查看自己的外观、stats、存活状态、穿戴槽与全部物品。stats 与物品上的数值只有 hp / max_hp、damage、block：damage 是基础伤害，block 直接抵扣受到的伤害。只读。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };
}

/** 只返回对方携带的物品，不暴露 stats 或状态。 */
export function buildObserveActorTool(
  availableTargetActorRefs: readonly string[],
  mode: "actor" | "stage" = "actor",
): ToolDefinition {
  const targetDescription = mode === "actor" ? "同场景角色的引用（名字 或 #编号）" : "本场景角色名";
  return {
    type: "function",
    function: {
      name: "observe_actor",
      description:
        mode === "actor"
          ? "查看同场景目标携带的物品（含其穿戴）；看不到对方的 stats 或存活状态。只读。"
          : "查看本场景角色携带的物品（含其穿戴）；看不到对方的 stats 或存活状态。只读。",
      parameters: {
        type: "object",
        properties: {
          targetActorRef: {
            type: "string",
            enum: availableTargetActorRefs,
            description: targetDescription,
          },
        },
        required: ["targetActorRef"],
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

/** 只读：让 NPC 回看自己去过、以及只听过名字的场景，不占行动。 */
export function buildKnownStagesTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_known_stages",
      description: "查看你知道的场景：去过的，以及只知道真名、还没去过的。只读，不占行动。",
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
 * 端点只能是知道真名的场景，见 `route.ts` 的规划规则。
 */
export function buildRecallRouteTool(stageRefs: readonly string[]): ToolDefinition {
  const candidates = stageRefs.length > 0 ? { enum: [...stageRefs] } : {};
  return {
    type: "function",
    function: {
      name: "recall_route",
      description: `回忆从 A 到 B 怎么走，结论会写进你自己的记忆（不占行动名额）。

起点与终点必须是你知道名字的场景（用名字，不能用 #序号——#序号 只是路上看得见、还没命名的站位）；中间站可以是不认识的地方，会写成 #序号。能走通就给整条路线；走不通时把断处标成 →[封着]→，可能给出多条。`,
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "起点场景名；省略表示你当前所在的场景。不接受 #序号",
            ...candidates,
          },
          to: { type: "string", description: "终点场景名。不接受 #序号", ...candidates },
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

/** 签名的当前名字；模型与玩家入口共用同一套格式校验。 */
export function parseSignatureName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0) {
    throw new GameError("invalid_action", "name 不能为空");
  }
  if (NAME_MARKER_PATTERN.test(name) || /\p{Cc}/u.test(name)) {
    throw new GameError("invalid_action", "name 不能包含系统标记（@ 或 #）或控制字符");
  }
  return name;
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

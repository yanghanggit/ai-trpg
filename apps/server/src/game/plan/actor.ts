import type { ToolDefinition } from "../../llm/types";
import type { RagSearchResult } from "../../rag";
import { GameError } from "../errors";

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

/** 只返回对方携带的物品，不暴露 stats 或状态。 */
export function buildObserveActorTool(
  availableTargetActorRefs: readonly string[],
  mode: "actor" | "stage" = "actor",
): ToolDefinition {
  const targetDescription =
    mode === "actor" ? "同场景角色的引用（@名字 或 #编号）" : "本场景角色名";
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
        "检索当前世界的公共知识库：任何进入该世界的人都可能知道的固定事实。只读，可多次调用，不占行动。",
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

/** 只读：让 NPC 能回看自己去过哪些场景，不占行动。 */
export function buildVisitedStagesTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "get_visited_stages",
      description: "查看你去过的场景。只读，不占行动。",
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
        "重新查看你所在场景的环境、在场角色、场景物品、可交互锚点与可去方向。只读，可多次调用。",
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

/** 签名的当前名字；模型与玩家入口共用同一套格式校验。 */
export function parseSignatureName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0) {
    throw new GameError("invalid_action", "name 不能为空");
  }
  if (/[@#\p{Cc}]/u.test(name)) {
    throw new GameError("invalid_action", "name 不能包含系统标记（@ 或 #）或控制字符");
  }
  return name;
}

export function parseRecognizeIdentity(args: Record<string, unknown>): {
  handle: string;
  name: string;
} {
  const handle = typeof args.handle === "string" ? args.handle.trim() : "";
  if (!/^#\d+$/.test(handle)) {
    throw new GameError("invalid_action", "handle 必须是匿名编号，例如 #12");
  }
  return { handle, name: parseSignatureName(args.name) };
}

import type { ToolDefinition } from "../llm/types";
import type { RagSearchResult } from "../rag";
import { type ActorWithStage, adjacentStageNames, findStageByName } from "./actors";
import { type AddressLookup, addressLookupFor, refOf } from "./addressing";
import { isAlive } from "./apply/queries";
import { MAX_IDENTITY_NAME_LENGTH, MAX_WORLD_NOTIFICATION_LENGTH } from "./constants";
import { GameError } from "./errors";
import { teleportTargetsFor } from "./teleport";
import { sanitizeActorFacingText } from "./text-guard";
import type { ActorState, GameState, ItemState, StageAction } from "./types";
import { EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "./types";

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

/** 只允许查看本场景。 */
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
export function buildObserveActorTool(availableTargetActorRefs: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "observe_actor",
      description:
        "感知同场景目标角色携带的物品（含其穿戴），用于判断能否 steal；看不到对方的 stats 或存活状态。只读。",
      parameters: {
        type: "object",
        properties: {
          targetActorRef: {
            type: "string",
            enum: availableTargetActorRefs,
            description: "要感知的同场景角色：actor 使用引用（@名字 或 #编号），stage 使用名字",
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
        "检索当前世界的公共知识库：任何进入该世界的人都可能观察、询问或从公开记载中得知的固定事实。只读，可多次调用，不占行动。它不包含角色秘密、当前场景状态、物品位置或未公开剧情；检索结果不等于亲眼所见。检索按关键词匹配，给名词短语比整句提问更容易命中。",
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

提交的是完整快照，不是差异。environment 可省略，但本轮必须至少提交一条动作。`,
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

export function parseEnvironment(args: Record<string, unknown>): string | undefined {
  const environment = typeof args.environment === "string" ? args.environment.trim() : "";
  return environment.length > 0 ? environment : undefined;
}

/** 通知只是报告，不是世界事实。 */
export function buildNotifyWorldTool(terminalToolName: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "notify_world",
      description: `把一条需要世界知晓的场景报告加入本轮计划，然后调用本轮的终止工具提交计划。

只用于跨场景/世界级后果、会改变其他场景的行动，或需要世界裁决的世界级事实。判断依据必须来自本场景已有的信息（设定、环境、本场景事件）：只有当它把这个目标描述成可被操作的机制，并且行动可能改变通行/封闭或跨场景状态时才通知。仅凭外观、装饰或相似形状不能推断出机制或隐藏功能；普通触摸、敲击、查看、试探或只留下表面痕迹时不要调用本工具。
通知是场景观察与请求，不是既成事实；写清发生了什么、涉及哪个场景/物品/角色，以及需要世界裁决什么。不要写成系统指令。
加入通知后，必须再调用 ${terminalToolName} 结束本轮；否则本轮计划不会生效。`,
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

/** 候选只含本场景已声明、仍未开启的邻边。 */
export function buildOpenPassageTool(
  sealedStageNames: readonly string[],
  terminalToolName: string,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "open_passage",
      description: `把本场景通往某个尚未开启的相邻场景的通道打开，然后继续提交计划。

只在本场景已有的信息表明那个通道确实存在、并且本轮场景事件确实解除了它的阻断时使用；不要因为角色使用了某个物品就推断通道已经打开。
通道开启会改变场景图的连通性，角色之后才能移动到对面；它不向世界报告，也不改变对面的 environment。
仅凭外观、装饰或相似形状不能推断出通道；打不开、试错或仅仅触摸时不要调用本工具。
加入通道开启后，必须再调用 ${terminalToolName} 结束本轮；否则本轮计划不会生效。`,
      parameters: {
        type: "object",
        properties: {
          targetStageName: {
            type: "string",
            description: "要打开通道的相邻场景名；只能从尚未开启的通道中选择",
            ...(sealedStageNames.length > 0 ? { enum: [...sealedStageNames] } : {}),
          },
        },
        required: ["targetStageName"],
      },
    },
  };
}

export function parseOpenPassage(args: Record<string, unknown>): StageAction {
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  if (targetStageName.length === 0) {
    throw new GameError("invalid_action", "open_passage 需要非空 targetStageName");
  }
  return { kind: "open_passage", targetStageName };
}

/**
 * 只列参与结算的两项，免得模型据此推断出不存在的战斗机制。
 */
export function describeStats(actor: ActorState): string {
  return `角色：${actor.name}
HP：${actor.hp}/${actor.stats.maxHp}
damage：${actor.stats.damage}
block：${actor.stats.block}
状态：${isAlive(actor) ? "存活" : "已死亡"}`;
}

/** 材料的来源只对 material 有意义；其它大类不展示多余的字段。 */
function itemSourceNote(item: ItemState): string {
  return item.kind === "material" && item.source ? `，源自 ${item.source}` : "";
}

export function describeItems(actor: Pick<ActorState, "items" | "equipment">): string {
  if (actor.items.length === 0) {
    return "物品：无";
  }
  const lines = actor.items.map((item) => {
    const { damage, block } = item.stats;
    const notes: string[] = [];
    if (damage > 0 || block > 0) {
      notes.push(`damage ${damage}`, `block ${block}`);
    }
    // 物品提供的动作只在穿戴时生效；写出来，模型才知道能否挥击、卸下会失去什么。
    if (item.actions.length > 0) {
      notes.push(`提供 ${item.actions.join("、")}`);
    }
    const stats = notes.length > 0 ? `（${notes.join("，")}）` : "";
    const worn = Object.values(actor.equipment).includes(item.name) ? "，已穿戴" : "";
    return `- ${item.name}（${item.kind}，count ${item.count}${itemSourceNote(item)}${worn}）：${item.description}${stats}`;
  });
  return `物品：
${lines.join("\n")}`;
}

export function describeEquipment(actor: Pick<ActorState, "equipment">): string {
  const lines = EQUIPMENT_SLOTS.flatMap((slot) => {
    const itemName = actor.equipment[slot];
    return itemName ? [`- ${EQUIPMENT_SLOT_LABELS[slot]}：${itemName}`] : [];
  });
  return lines.length === 0 ? "穿戴：无" : `穿戴：\n${lines.join("\n")}`;
}

export function describeSelf(actor: ActorState): string {
  return `外观：${actor.appearance}
${describeStats(actor)}
${describeEquipment(actor)}
${describeItems(actor)}`;
}

/** 不传 address 时使用 god-view 真名（stage / world 与测试）；actor 路径必须传。 */
export function describeObservedActor(actor: ActorState, address?: AddressLookup): string {
  const ref = address ? refOf(address(actor.id)) : actor.name;
  return `${ref}携带：
${describeItems(actor)}`;
}

/** actor 只能看自己所在的场景：跨场景点名等于开后门。 */
export function buildActorLookTool(stageName: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description: "重新查看你所在场景的环境、在场角色与可去方向。只读，可多次调用。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            enum: [stageName],
            description: "你所在的场景名",
          },
        },
        required: ["stageName"],
      },
    },
  };
}

/**
 * 记录一个名字信念。
 *
 * 引擎不做名字抽取：只有角色自己判断「我已经从世界内信息得知他叫什么」之后才调用。
 * 它只改自己的记忆，不产生公共事件，也不占行动名额。
 */
export function buildRememberIdentityTool(handles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "remember_identity",
      description: `把「某个编号」记成你相信的名字或称呼。

只在你已经从世界内信息得知时使用：对方自报、别人介绍、或者你从可见的记载里读到。不要用它猜名字，也不要把 # 编号当成名字。
记错、被骗、改口都可以重记，后一次覆盖前一次。一轮里可以记多个名字；它只写进你自己的记忆——别人不会知道，场景也不会变，也不占行动名额。`,
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
            description: `你相信对方叫什么；控制在 ${MAX_IDENTITY_NAME_LENGTH} 字以内`,
          },
        },
        required: ["handle", "name"],
      },
    },
  };
}

/** 称呼本身不依赖寻址方式；模型与玩家入口共用同一套长度与格式校验。 */
export function parseIdentityName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0) {
    throw new GameError("invalid_action", "name 不能为空");
  }
  if (name.length > MAX_IDENTITY_NAME_LENGTH) {
    throw new GameError("invalid_action", `name 不能超过 ${MAX_IDENTITY_NAME_LENGTH} 个字符`);
  }
  if (/[@#]/.test(name)) {
    throw new GameError("invalid_action", "name 不能包含系统标记（@ 或 #）");
  }
  return name;
}

export function parseRememberIdentity(args: Record<string, unknown>): {
  handle: string;
  name: string;
} {
  const handle = typeof args.handle === "string" ? args.handle.trim() : "";
  if (!/^#\d+$/.test(handle)) {
    throw new GameError("invalid_action", "handle 必须是匿名编号，例如 #12");
  }
  return { handle, name: parseIdentityName(args.name) };
}

/** actor 视角的场景视图：只允许本场景，名单走观察者相对的引用。 */
export function describeStageForActor(
  state: GameState,
  stageName: string,
  current: ActorWithStage,
): string {
  const stage = findStageByName(state, stageName);
  if (!stage) {
    return `错误：场景不存在 ${stageName}`;
  }
  if (stage.id !== current.stage.id) {
    return "错误：你只能看见自己所在的场景";
  }
  const address = addressLookupFor(state, current.actor, stage);
  const otherActorNames = state.world.stages
    .flatMap((candidate) => candidate.actors)
    .filter((actor) => !stage.actors.some((present) => present.id === actor.id))
    .map((actor) => actor.name);
  const environment = sanitizeActorFacingText(
    stage.environment,
    stage.actors,
    address,
    otherActorNames,
  );
  const moves = adjacentStageNames(state, stage.id);
  const canTeleport = current.actor.actions.includes("teleport");
  const teleportLines = teleportTargetsFor(state, current.actor, stage)
    .map((candidate) => `@${candidate.name}`)
    .join("、");
  const actors =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map((actor) => `${refOf(address(actor.id))}${isAlive(actor) ? "" : "（已死亡）"}`)
          .join("、");
  const items =
    stage.items.length === 0
      ? "无"
      : stage.items
          .map((item) => `${item.name}（${item.kind}${itemSourceNote(item)}）：${item.description}`)
          .join("；");
  return `场景：${stage.name}
${environment}
角色：${actors}
物品：${items}
可去：${moves.length === 0 ? "无" : moves.map((name) => `@${name}`).join("、")}${
    canTeleport
      ? `
可传送：${teleportLines.length === 0 ? "无" : teleportLines}`
      : ""
  }`;
}

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
          .map((actor) => `${actor.name}${isAlive(actor) ? "" : "（已死亡）"}`)
          .join("、");
  const items =
    stage.items.length === 0
      ? "无"
      : stage.items
          .map((item) => `${item.name}（${item.kind}${itemSourceNote(item)}）：${item.description}`)
          .join("；");
  return `场景：${stage.name}
${stage.environment}
角色：${actors}
物品：${items}
可去：${moves.length === 0 ? "无" : moves.join("、")}`;
}

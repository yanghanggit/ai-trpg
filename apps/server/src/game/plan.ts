import type { ToolDefinition } from "../llm/types";
import {
  COMMUNICATION_ACTION_TYPES,
  isCommunicationAction,
  isMovementAction,
  MAX_MIND_LENGTH,
  MOVEMENT_ACTION_TYPES,
} from "./actions";
import { adjacentStageNames, findStageByName } from "./actors";
import { GameError } from "./errors";
import type {
  ActorIntent,
  ActorPlan,
  ActorState,
  CommunicationIntent,
  GameState,
  MovementIntent,
  Skill,
  SkillIntent,
  SkillPurposeKind,
} from "./types";

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
      description: "查看同场景目标角色的 stats、状态效果与持有的物品。只读。",
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

/** 构造沟通 intent 工具；它只把行动加入计划，不直接修改游戏状态。 */
export function buildCommunicateTool(availableTargetActorNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "communicate",
      description:
        "把一次沟通行动加入本轮计划。say 公开对目标说话；whisper 只让目标听见；announce 向当前场景公开说话。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: `第一人称内心独白，说明为什么这样做，控制在 ${MAX_MIND_LENGTH} 字以内`,
          },
          mode: {
            type: "string",
            enum: [...COMMUNICATION_ACTION_TYPES],
            description: "say=有目标公开；whisper=有目标私下；announce=无目标公开",
          },
          targetActorName: {
            type: "string",
            description: "say/whisper 时必填：当前场景内唯一的沟通对象；announce 留空。",
            ...(availableTargetActorNames.length > 0 ? { enum: availableTargetActorNames } : {}),
          },
          message: {
            type: "string",
            description: "你要说出的内容",
          },
        },
        required: ["mind", "mode", "message"],
      },
    },
  };
}

/** 构造移动 intent 工具；move 与 wait 互斥。 */
export function buildMoveTool(availableStageNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "move",
      description: "把一次移动或等待加入本轮计划。move 移动到相邻场景；wait 留在原地。",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: [...MOVEMENT_ACTION_TYPES],
            description: "move=移动到相邻场景；wait=留在原地",
          },
          targetStageName: {
            type: "string",
            description: "move 时必填：目标场景名；wait 留空。",
            ...(availableStageNames.length > 0 ? { enum: availableStageNames } : {}),
          },
        },
        required: ["mode"],
      },
    },
  };
}

/** 构造技能 intent 工具；技能、目标、道具与目的都由本次行动选择。 */
export function buildSkillTool(
  availableSkills: readonly Skill[],
  availableTargetActorNames: readonly string[],
  availableItemNames: readonly string[],
  currentStageName?: string,
  selfActorName?: string,
): ToolDefinition {
  const purposeKinds = [...new Set(availableSkills.flatMap((skill) => skill.purposeKinds))];
  const targetActorNames = [
    ...new Set([
      ...availableTargetActorNames,
      ...(selfActorName === undefined ? [] : [selfActorName]),
    ]),
  ];
  return {
    type: "function",
    function: {
      name: "use_skill",
      description:
        "把一次技能行动加入本轮计划。选择自己掌握的技能、目的、目标与可选道具；先用 get_actor 查看目标持有的物品。",
      parameters: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            enum: availableSkills.map((skill) => skill.key),
            description: "要使用的技能 key",
          },
          purpose: {
            type: "string",
            enum: purposeKinds,
            description:
              "本次技能目的：damage 造成伤害；steal 从目标取物；give 把自身物品给予目标；pickup 拾取场景物品；use 使用自身物品",
          },
          targetActorName: {
            type: "string",
            description: "damage/steal/give 的目标角色，或 use 的目标角色；可以是自己",
            ...(targetActorNames.length > 0 ? { enum: targetActorNames } : {}),
          },
          targetStageName: {
            type: "string",
            description: "use 的目标场景；当前只允许 actor 所在场景",
            ...(currentStageName === undefined ? {} : { enum: [currentStageName] }),
          },
          itemName: {
            type: "string",
            description: "steal 要取走的物品、give/use 要交出的物品、pickup 要拾取的场景物品",
          },
          itemNames: {
            type: "array",
            items: {
              type: "string",
              ...(availableItemNames.length > 0 ? { enum: availableItemNames } : {}),
            },
            description: "damage 等技能额外选用的自身物品；可以为空",
          },
        },
        required: ["skill", "purpose"],
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

/** 渲染自身 stats，供 get_stats 工具返回。 */
export function describeStats(actor: ActorState): string {
  return [
    `角色：${actor.name}`,
    `HP：${actor.hp}/${actor.maxHp}`,
    `attack：${actor.attack}`,
    `defense：${actor.defense}`,
    `speed：${actor.speed}`,
    `状态：${actor.death ? "已死亡" : "存活"}`,
    `状态效果：${
      actor.statusEffects.length === 0
        ? "无"
        : actor.statusEffects.map((status) => `${status.name}（${status.kind}）`).join("、")
    }`,
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
    stage.narrative,
    `角色：${stage.actors.length === 0 ? "无" : stage.actors.map((actor) => `${actor.name}${actor.death ? "（已死亡）" : ""}`).join("、")}`,
    `物品：${stage.items.length === 0 ? "无" : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("；")}`,
    `可去：${moves.length === 0 ? "无" : moves.join("、")}`,
  ].join("\n");
}

/** 把 communicate 工具参数转换为沟通 intent；只检查形状。 */
export function parseCommunication(args: Record<string, unknown>): CommunicationIntent {
  const mode = args.mode;
  if (!isCommunicationAction(mode)) {
    throw new GameError("invalid_action", `非法沟通 mode: ${String(mode)}`);
  }
  const message = typeof args.message === "string" ? args.message : "";
  if (message.trim().length === 0) {
    throw new GameError("invalid_action", "沟通动作需要非空 message");
  }
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  if (mind.length === 0) {
    throw new GameError("invalid_action", "沟通动作需要非空 mind");
  }
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : undefined;
  return {
    kind: "communication",
    mind,
    mode,
    ...(targetActorName ? { targetActorName } : {}),
    message,
  };
}

/** 把 move 工具参数转换为移动 intent；只检查形状。 */
export function parseMovement(args: Record<string, unknown>): MovementIntent {
  const mode = args.mode;
  if (!isMovementAction(mode)) {
    throw new GameError("invalid_action", `非法移动 mode: ${String(mode)}`);
  }
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : undefined;
  return {
    kind: "movement",
    mode,
    ...(targetStageName ? { targetStageName } : {}),
  };
}

/** 把 use_skill 工具参数转换为技能 intent；只检查形状。 */
export function parseSkill(
  args: Record<string, unknown>,
  availableSkills: readonly Skill[],
): SkillIntent {
  const skillKey = typeof args.skill === "string" ? args.skill.trim() : "";
  const skill = availableSkills.find((candidate) => candidate.key === skillKey);
  if (!skill) {
    throw new GameError("invalid_action", `actor 未掌握技能: ${skillKey}`);
  }

  const purposeKind = typeof args.purpose === "string" ? args.purpose.trim() : "";
  if (!(skill.purposeKinds as readonly string[]).includes(purposeKind)) {
    throw new GameError("invalid_action", `技能 ${skill.name} 不支持目的: ${purposeKind}`);
  }

  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  const rawItemNames = Array.isArray(args.itemNames) ? args.itemNames : [];
  const itemNames = [
    ...new Set(
      rawItemNames
        .filter((itemName): itemName is string => typeof itemName === "string")
        .map((itemName) => itemName.trim())
        .filter((itemName) => itemName.length > 0),
    ),
  ];

  switch (purposeKind as SkillPurposeKind) {
    case "damage":
      if (targetActorName.length === 0) {
        throw new GameError("invalid_action", "damage 目的需要非空 targetActorName");
      }
      return {
        kind: "skill",
        skill,
        itemNames,
        purpose: { kind: "damage", targetActorName },
      };
    case "steal":
    case "give": {
      if (targetActorName.length === 0 || itemName.length === 0) {
        throw new GameError(
          "invalid_action",
          `${purposeKind} 目的需要 targetActorName 与 itemName`,
        );
      }
      const transferKind: "steal" | "give" = purposeKind === "steal" ? "steal" : "give";
      return {
        kind: "skill",
        skill,
        itemNames,
        purpose: { kind: transferKind, targetActorName, itemName },
      };
    }
    case "pickup":
      if (itemName.length === 0) {
        throw new GameError("invalid_action", "pickup 目的需要非空 itemName");
      }
      return { kind: "skill", skill, itemNames, purpose: { kind: "pickup", itemName } };
    case "use": {
      if (itemName.length === 0) {
        throw new GameError("invalid_action", "use 目的需要非空 itemName");
      }
      if ((targetActorName.length === 0) === (targetStageName.length === 0)) {
        throw new GameError(
          "invalid_action",
          "use 目的需要 targetActorName 或 targetStageName 二选一",
        );
      }
      return {
        kind: "skill",
        skill,
        itemNames,
        purpose: {
          kind: "use",
          itemName,
          ...(targetActorName.length > 0 ? { targetActorName } : {}),
          ...(targetStageName.length > 0 ? { targetStageName } : {}),
        },
      };
    }
    case "narrative": {
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (description.length === 0) {
        throw new GameError("invalid_action", "narrative 目的需要非空 description");
      }
      return { kind: "skill", skill, itemNames, purpose: { kind: "narrative", description } };
    }
    default:
      throw new GameError("invalid_action", `不支持技能目的: ${purposeKind}`);
  }
}

/** 返回 intent 的互斥类别；沟通之外都占用同一个行动槽。 */
export function intentClass(intent: ActorIntent): "communication" | "action" {
  return intent.kind === "communication" ? "communication" : "action";
}

export function intentClassLabel(intentClassValue: ReturnType<typeof intentClass>): string {
  return intentClassValue === "communication" ? "沟通" : "行动";
}

/** 把 intent 加入计划；同类别只能有一个。 */
export function addIntent(plan: ActorPlan, intent: ActorIntent): void {
  const incomingClass = intentClass(intent);
  if (plan.intents.some((existing) => intentClass(existing) === incomingClass)) {
    throw new GameError("invalid_action", `本轮已有${intentClassLabel(incomingClass)}类行动`);
  }
  plan.intents.push(intent);
}

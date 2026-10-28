import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import { findActor } from "./actors";
import { entityNameMatches } from "./addressing";
import { bumpGameVersion } from "./apply/messages";
import { isAlive } from "./apply/queries";
import { formatBaseBody } from "./body";
import { DEFAULT_APPEARANCE_MAX_ROUNDS, MAX_APPEARANCE_LENGTH } from "./constants";
import { GameError } from "./errors";
import { equippedItems, equipSlot, unequipSlot } from "./items";
import { loadAgentMemory } from "./memory";
import { setActorAppearance, setActorEquipment } from "./persistence/actors";
import { lockGameRow } from "./persistence/games";
import { getGameState } from "./service";
import {
  type ActorState,
  EQUIPMENT_SLOT_LABELS,
  type EquipmentSlot,
  type GameState,
} from "./types";

export type AppearanceTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: Parameters<typeof agentLoop>[0]["trace"];
  /** 死亡阶段的外观更新：写尸体而不是活人。 */
  dead?: boolean;
};

export type AppearanceTurnResult = {
  ok: boolean;
  appearance: string | null;
  state: GameState;
};

export type EquipmentResult = AppearanceTurnResult & {
  slot: EquipmentSlot;
  itemName: string | null;
};

/** 外观推理只有这一个终止工具。 */
export function buildSubmitAppearanceTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_appearance",
      description:
        "提交重新推理后的当前可见外观。只写第三人称可见的外观快照，不写心理、名字与规则，也不要解释推理过程。",
      parameters: {
        type: "object",
        properties: {
          appearance: {
            type: "string",
            description: "融合基础体型、当前穿戴与自身润色后的第三人称外观快照",
          },
        },
        required: ["appearance"],
      },
    },
  };
}

export function parseAppearance(args: Record<string, unknown>): string {
  const appearance = typeof args.appearance === "string" ? args.appearance.trim() : "";
  if (appearance.length === 0) {
    throw new GameError("invalid_action", "appearance 不能为空");
  }
  if (appearance.length > MAX_APPEARANCE_LENGTH) {
    throw new GameError("invalid_action", `appearance 不能超过 ${MAX_APPEARANCE_LENGTH} 个字符`);
  }
  return appearance;
}

export function buildAppearanceObservation(actor: ActorState, dead = false): string {
  const worn = equippedItems(actor);
  const wornLines =
    worn.length === 0
      ? "无"
      : worn
          .map(
            ({ slot, item }) =>
              `- ${EQUIPMENT_SLOT_LABELS[slot]}：${item.name}（${item.kind}）：${item.description}`,
          )
          .join("\n");

  const task = dead
    ? `角色已经倒下（当前生命 0）。写一段尸体外观快照：姿势、伤口、血迹、衣物与装备的错位、周围的痕迹。
记忆里若有可见的变化与痕迹，把它们写进尸体状态；仍不写动作、心理或后续，不把死亡写成原因，也不复述数值。`
    : `结合你的记忆（伤势、血迹、灰尘、姿态、最近发生的事，以及记忆里出现的可见变化），把基础体型、当前穿戴与自身润色融合成一段第三人称外观快照。`;

  return `# 外观更新

你要为${actor.name}重新推理“当前可见外观”。

## 基础体型

${formatBaseBody(actor.baseBody)}

## 当前穿戴

${wornLines}

# 本轮任务

${task}

只使用上面列出的穿戴；未列出的衣物、护甲、武器与饰品不存在，不要虚构。base body 没有写到的衣物视为没有穿上。不要改写种族与身体特征。

穿戴不等于露出：只写从外面能看见的部分。被衣物、斗篷或绷带遮住的饰品、贴身物件与藏在衣兜里的东西不要提；如果一件饰品在常见穿戴下会被遮住，就让外观绕开它，而不是为了提到它去改写衣着。反之，只有明显露在外面的饰品（颈间、耳侧、腰侧、手持、垂在衣襟外的链子）才写进外观。

只写可见外观，不写心理、名字与规则；不要解释过程。完成后调用 submit_appearance 提交。`;
}

/**
 * 只更新运行时外观，不改 system prompt：base body 才是稳定身份。
 */
export async function runAppearanceTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceTurnOptions,
): Promise<AppearanceTurnResult> {
  const state = await getGameState(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActor(state, actorRef);
  const memory = await loadAgentMemory(db, state.game.id, "actor", actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${actor.name}`);
  }

  const tool = buildSubmitAppearanceTool();
  let submitted: string | null = null;
  const dead = !isAlive(actor);
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: buildAppearanceObservation(actor, dead),
    messages: memory.messages,
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (submitted !== null) {
          throw new GameError("invalid_action", "外观已提交");
        }
        submitted = parseAppearance(args);
        return "外观已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_APPEARANCE_MAX_ROUNDS,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success || submitted === null) {
    return { ok: false, appearance: null, state: await getGameState(db, state.game.id) };
  }
  const appearance = submitted;

  const now = new Date();
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能更新外观: ${game.status}`);
    }
    await setActorAppearance(tx, actor.id, appearance);
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    appearance,
    state: await getGameState(db, state.game.id),
  };
}

/**
 * 换装后立刻重算外观；LLM 调用在事务外，槽位与外观各自短事务。
 */
export async function setEquipmentSlot(
  db: Database,
  gameRef: string,
  actorRef: string,
  slot: EquipmentSlot,
  itemName: string | null,
  options: AppearanceTurnOptions,
): Promise<EquipmentResult> {
  const state = await getGameState(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActor(state, actorRef);

  let equipment = actor.equipment;
  if (itemName !== null) {
    const item = actor.items.find((candidate) => entityNameMatches(candidate.name, itemName));
    if (!item) {
      throw new GameError("not_found", `actor 没有物品: ${itemName}`);
    }
    equipment = equipSlot(equipment, slot, item);
  } else {
    equipment = unequipSlot(equipment, slot);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能换装: ${game.status}`);
    }
    await setActorEquipment(tx, actor.id, equipment, now);
    await bumpGameVersion(tx, state.game.id, now);
  });

  const appearance = await runAppearanceTurn(db, gameRef, actor.id, options);
  return { ...appearance, slot, itemName };
}

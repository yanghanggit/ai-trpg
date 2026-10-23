import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, games } from "../db/schema";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import { findActor } from "./actors";
import { bumpGameVersion } from "./apply/messages";
import { formatBaseBody } from "./body";
import { DEFAULT_APPEARANCE_MAX_ROUNDS, MAX_APPEARANCE_LENGTH } from "./constants";
import { GameError } from "./errors";
import { equippedItems } from "./items";
import { loadAgentMemory } from "./memory";
import { getGameState } from "./service";
import {
  type ActorState,
  EQUIPMENT_SLOT_KINDS,
  EQUIPMENT_SLOT_LABELS,
  type EquipmentSlot,
  type GameState,
} from "./types";

export type AppearanceTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
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

/** 构造提交外观的工具；外观推理只有这一个终止工具。 */
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

/** 解析 submit_appearance 参数；只检查形状与长度。 */
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

/** 构造外观推理的当前观察：基础体型 + 当前穿戴；自身润色从 actor memory 读取。 */
export function buildAppearanceObservation(actor: ActorState): string {
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

  return `# 外观更新

你要为${actor.name}重新推理“当前可见外观”。

## 基础体型

${formatBaseBody(actor.baseBody)}

## 当前穿戴

${wornLines}

# 本轮任务

结合你的记忆（伤势、血迹、灰尘、姿态、最近发生的事），把基础体型、当前穿戴与自身润色融合成一段第三人称外观快照。

只使用上面列出的穿戴；未列出的衣物、护甲、武器与饰品不存在，不要虚构。base body 没有写到的衣物视为没有穿上。不要改写种族与身体特征。

只写可见外观，不写心理、名字与规则；不要解释过程。完成后调用 submit_appearance 提交。`;
}

/**
 * 用 actor memory 作为上下文跑一次外观推理，并把结果写回 `actors.appearance`。
 *
 * 只更新运行时外观，不修改 system prompt：base body 才是稳定身份，appearance
 * 是动态量，供其他 actor 与 stage 的观察使用。
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
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: buildAppearanceObservation(actor),
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
  });

  if (!loop.success || submitted === null) {
    return { ok: false, appearance: null, state: await getGameState(db, state.game.id) };
  }
  const appearance = submitted;

  const now = new Date();
  await db.transaction(async (tx) => {
    const [game] = await tx
      .select()
      .from(games)
      .where(eq(games.id, state.game.id))
      .limit(1)
      .for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能更新外观: ${game.status}`);
    }
    await tx.update(actors).set({ appearance, updatedAt: now }).where(eq(actors.id, actor.id));
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    appearance,
    state: await getGameState(db, state.game.id),
  };
}

/**
 * 换装入口：把某个槽位指向一件物品（或清空），然后立刻重算外观。
 *
 * 槽位只保存物品名；物品自身不知道自己被穿戴。后续装备动作、UI 换装
 * 都调用这里；LLM 调用发生在事务外，槽位与外观更新各自使用短事务。
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

  if (itemName !== null) {
    const item = actor.items.find((candidate) => candidate.name === itemName);
    if (!item) {
      throw new GameError("not_found", `actor 没有物品: ${itemName}`);
    }
    if (!EQUIPMENT_SLOT_KINDS[slot].includes(item.kind)) {
      throw new GameError(
        "invalid_action",
        `物品不能放进${EQUIPMENT_SLOT_LABELS[slot]}槽: ${itemName}`,
      );
    }
  }

  const equipment = { ...actor.equipment };
  if (itemName !== null) {
    for (const [otherSlot, otherName] of Object.entries(equipment)) {
      if (otherName === itemName) {
        delete equipment[otherSlot as EquipmentSlot];
      }
    }
    equipment[slot] = itemName;
  } else {
    delete equipment[slot];
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const [game] = await tx
      .select()
      .from(games)
      .where(eq(games.id, state.game.id))
      .limit(1)
      .for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能换装: ${game.status}`);
    }
    await tx.update(actors).set({ equipment, updatedAt: now }).where(eq(actors.id, actor.id));
    await bumpGameVersion(tx, state.game.id, now);
  });

  const appearance = await runAppearanceTurn(db, gameRef, actor.id, options);
  return { ...appearance, slot, itemName };
}

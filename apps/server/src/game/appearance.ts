import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import { findActorByName } from "./actors";
import { bumpGameVersion } from "./apply/messages";
import { isAlive } from "./apply/queries";
import { DEFAULT_APPEARANCE_MAX_ROUNDS, DEFAULT_LLM_ERROR_RETRIES } from "./constants";
import { GameError } from "./errors";
import { equippedItems, equipSlot, unequipSlot } from "./items";
import { loadAgentMemory } from "./memory";
import { renderAppearanceChange } from "./observation-text";
import { appendCustomStageObservation } from "./observations";
import { setActorEquipment } from "./persistence/actors";
import { recordAppearance } from "./persistence/appearances";
import { lockGameRow } from "./persistence/games";
import { getGameStateSlice, readTurnDelivery } from "./read/game-state";
import { assertWorldFaceText } from "./text-guard";
import {
  type ActorState,
  type AppearanceWornItem,
  EQUIPMENT_SLOT_LABELS,
  type EquipmentSlot,
  type TurnDelivery,
} from "./types";

export type AppearanceTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: Parameters<typeof agentLoop>[0]["trace"];
  /** 死亡阶段的外观更新：写尸体而不是活人。 */
  dead?: boolean;
  /** 调用方已知的本次变化简报；有值时不再让角色自己生成。 */
  brief?: string;
  /** 是否先让角色自己提交一段变化简报，再生成最终外观；死亡阶段使用。 */
  requestBrief?: boolean;
  /**
   * 写回后是否向同场景其他 actor 广播外观变化。默认开；死亡收尾与批量维护
   * 关掉，避免在已有广播的事件后面重复贴一条。
   */
  broadcast?: boolean;
};

export type AppearanceTurnResult = TurnDelivery & {
  ok: boolean;
  appearance: string | null;
};

export type EquipmentResult = AppearanceTurnResult & {
  slot: EquipmentSlot;
  itemName: string | null;
};

/** 快照里的提示词版本；提示词结构改变时递增，便于复盘时区分。 */
const APPEARANCE_PROMPT_VERSION = 1;

/** 外观推理的终止工具。 */
export function buildSubmitAppearanceTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_appearance",
      description: "提交重新推理后的当前可见外观。",
      parameters: {
        type: "object",
        properties: {
          appearance: {
            type: "string",
            description: "融合形态、当前穿戴与自身润色后的第三人称外观快照",
          },
        },
        required: ["appearance"],
      },
    },
  };
}

/** 先提交“本次变化”的简报；不是终止工具，提交后继续生成最终外观。 */
export function buildSubmitAppearanceBriefTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "submit_appearance_brief",
      description: "提交本次外观变化的第三人称简报。",
      parameters: {
        type: "object",
        properties: {
          brief: {
            type: "string",
            description: "一段第三人称可见变化，供随后生成最终外观参考",
          },
        },
        required: ["brief"],
      },
    },
  };
}

export function parseAppearanceBrief(
  args: Record<string, unknown>,
  actorNames: readonly string[] = [],
): string {
  const brief = typeof args.brief === "string" ? args.brief.trim() : "";
  if (brief.length === 0) {
    throw new GameError("invalid_action", "appearance brief 不能为空");
  }
  assertWorldFaceText(brief, actorNames, "appearance brief");
  return brief;
}

export function parseAppearance(
  args: Record<string, unknown>,
  actorNames: readonly string[] = [],
): string {
  const appearance = typeof args.appearance === "string" ? args.appearance.trim() : "";
  if (appearance.length === 0) {
    throw new GameError("invalid_action", "appearance 不能为空");
  }
  // 外观会进名单与观察（世界面）：名字与引用都不允许混进来。
  assertWorldFaceText(appearance, actorNames, "appearance");
  return appearance;
}

export type AppearanceBuildInput = {
  inputMessage: string;
  context: {
    form: string;
    dead: boolean;
    worn: AppearanceWornItem[];
  };
};

export function buildAppearanceTurnInput(
  actor: ActorState,
  dead = false,
  brief?: string,
  requestBrief = false,
): AppearanceBuildInput {
  // 饰品不参与外观推理：这个大类在不同题材里语义漂移（它也可能指与外观无关的植入物），
  // 引擎只保留槽位与穿戴索引，外观只消费衣物与武器。见 docs/data-driven.md。
  const worn = equippedItems(actor).filter(({ slot }) => slot !== "accessory");
  const wornLines =
    worn.length === 0
      ? "无"
      : worn
          .map(
            ({ slot, item }) =>
              `- ${EQUIPMENT_SLOT_LABELS[slot]}：${item.name}（${item.kind}）：${item.description}`,
          )
          .join("\n");
  const wornSnapshot = worn.map(({ slot, item }) => ({
    slot,
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    description: item.description,
  }));

  const task = dead
    ? `角色已经倒下（当前生命 0）。写一段尸体外观快照：姿势、伤口、血迹、衣物与装备的错位、周围的痕迹。
记忆里若有可见的变化与痕迹，把它们写进尸体状态；仍不写动作、心理或后续，不把死亡写成原因，也不复述数值。`
    : `结合你的记忆（伤势、血迹、灰尘、姿态、最近发生的事，以及记忆里出现的可见变化），把形态、当前穿戴与自身润色融合成一段第三人称外观快照。`;

  const inputMessage = `# 外观更新

你要为${actor.name}重新推理“当前可见外观”。

## 形态

${actor.signature.form}

## 当前穿戴

${wornLines}
${brief ? `\n## 本次变化\n\n${brief}\n\n以下是本次事件已经确认的可见变化，作为参考；与形态、穿戴和记忆冲突时以事实为准，不要机械照抄。` : ""}
${requestBrief && !brief ? `\n## 生成步骤\n\n先调用 submit_appearance_brief，用一小段第三人称可见事实写下本次变化（死因、伤口、可见损伤、姿势、衣物与装备的错位等）；然后再调用 submit_appearance 提交最终外观。简报只写可见结果，不写最终外观全文。` : ""}

# 本轮任务

${task}

只使用上面列出的穿戴；未列出的衣物与装备不存在，不要虚构。形态描述里没有写到的衣物视为没有穿上。不要改写种族与身体特征。

穿戴不等于露出：只写从外面能看见的部分。被衣物、斗篷或绷带遮住的贴身物件与藏在衣兜里的东西不要提，也不为了提到它去改写衣着。

只写可见外观，不写心理、名字与规则；不要解释过程。完成后调用 submit_appearance 提交。`;

  return {
    inputMessage,
    context: { form: actor.signature.form, dead, worn: wornSnapshot },
  };
}

/**
 * 只更新运行时外观，不改 system prompt：签名上的 form 才是稳定身份。
 */
export async function runAppearanceTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceTurnOptions,
): Promise<AppearanceTurnResult> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const { actor, stage } = findActorByName(state, actorRef);
  const actorNames = state.world.stages.flatMap((candidate) =>
    candidate.actors.map((present) => present.name),
  );
  const memory = await loadAgentMemory(db, state.game.id, "actor", actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${actor.name}`);
  }

  const tool = buildSubmitAppearanceTool();
  const providedBrief = options.brief
    ? parseAppearanceBrief({ brief: options.brief }, actorNames)
    : null;
  const briefTool =
    options.requestBrief && !providedBrief ? buildSubmitAppearanceBriefTool() : null;
  const tools = briefTool ? [tool, briefTool] : [tool];
  let submitted: string | null = null;
  let submittedBrief: string | null = null;
  const dead = !isAlive(actor);
  const maxRounds =
    options.maxRounds ??
    (briefTool ? DEFAULT_APPEARANCE_MAX_ROUNDS + 1 : DEFAULT_APPEARANCE_MAX_ROUNDS);
  const built = buildAppearanceTurnInput(
    actor,
    dead,
    providedBrief ?? undefined,
    options.requestBrief,
  );
  const handlers: Record<string, (args: Record<string, unknown>) => string> = {
    [tool.function.name]: (args) => {
      if (submitted !== null) {
        throw new GameError("invalid_action", "外观已提交");
      }
      submitted = parseAppearance(args, actorNames);
      return "外观已提交";
    },
  };
  if (briefTool) {
    handlers[briefTool.function.name] = (args) => {
      if (submittedBrief !== null) {
        throw new GameError("invalid_action", "变化简报已提交");
      }
      submittedBrief = parseAppearanceBrief(args, actorNames);
      return "简报已记录。现在调用 submit_appearance 提交最终外观。";
    };
  }
  const loop = await agentLoop({
    name: actor.name,
    inputMessage: built.inputMessage,
    messages: memory.messages,
    mutateMessages: false,
    tools,
    handlers,
    terminalTools: [tool],
    service: options.service,
    maxRounds,
    errorRetries: DEFAULT_LLM_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success || submitted === null) {
    return { ...(await readTurnDelivery(db, state.game.id)), ok: false, appearance: null };
  }
  const appearance = submitted;

  const now = new Date();
  const broadcast = options.broadcast !== false && !dead;
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, state.game.id);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${state.game.id}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能更新外观: ${game.status}`);
    }
    await recordAppearance(tx, {
      gameId: state.game.id,
      actorId: actor.id,
      text: appearance,
      input: {
        version: 1,
        promptVersion: APPEARANCE_PROMPT_VERSION,
        source: "runtime",
        // provider 契约尚未暴露模型名；先留空，不为审计改 LLM 基建。
        model: null,
        prompt: {
          messages: memory.messages,
          inputMessage: built.inputMessage,
          tools,
          maxRounds,
        },
        context: {
          ...built.context,
          contentVersion: state.game.contentVersion,
          ...((providedBrief ?? submittedBrief)
            ? { brief: providedBrief ?? submittedBrief ?? undefined }
            : {}),
        },
      },
      now,
    });
    if (broadcast) {
      // 外观已写库：观察者渲染取到的是新值。引用按观察者渲染，名字不会外泄。
      await appendCustomStageObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        (_observerId, address) => renderAppearanceChange(address(actor.id), appearance, stage.id),
        options.trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });

  return {
    ok: true,
    appearance,
    ...(await readTurnDelivery(db, state.game.id)),
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
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const actor = findActorByName(state, actorRef).actor;

  let equipment = actor.equipment;
  if (itemName !== null) {
    const item = actor.items.find((candidate) => candidate.name === itemName);
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

  const appearance = await runAppearanceTurn(db, gameRef, actor.name, options);
  return { ...appearance, slot, itemName };
}

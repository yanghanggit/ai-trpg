import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import type { TraceContext } from "../../debug/trace";
import { DEFAULT_ERROR_RETRIES } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import { findActorByName } from "../actor-state";
import { bumpGameVersion } from "../apply/messages";
import { DEFAULT_APPEARANCE_MAX_ROUNDS } from "../default-rounds";
import { GameError } from "../errors";
import { type LoadedMemory, loadAgentMemory } from "../memory";
import { appearanceChangeText, renderAppearanceChange } from "../observation-text";
import { appendCustomStageObservation, appendSelfObservation } from "../observations";
import { type AppearanceContext, recordAppearance } from "../persistence/appearances";
import { lockGameRow } from "../persistence/games";
import { getGameStateSlice, readTurnDelivery } from "../read/game-state";
import type { ActorState, GameStateSlice, StageState, TurnDelivery } from "../types";
import {
  buildAppearanceDeathInput,
  buildAppearanceUpdateInput,
  buildSubmitAppearanceTool,
  parseAppearance,
} from "./prompt";

export type AppearanceOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: TraceContext;
};

export type AppearanceResult = TurnDelivery & {
  ok: boolean;
  appearance: string | null;
};

/**
 * 活人的外观：按形态 + 穿戴 + 记忆重新生成，覆盖当前记录。
 *
 * 只更新运行时外观，不改 system prompt：签名上的 `form` 才是稳定身份。写回后把这次
 * 可见变化写进记忆：自己一条、同场景他人各一条。
 */
export async function updateAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceResult> {
  const target = await loadAppearanceTarget(db, gameRef, actorRef);
  const input = buildAppearanceUpdateInput(target.actor);
  const maxRounds = options.maxRounds ?? DEFAULT_APPEARANCE_MAX_ROUNDS;

  const appearance = await renderAppearance({
    target,
    inputMessage: input.inputMessage,
    maxRounds,
    options,
  });
  if (appearance === null) {
    return turnResult(db, target.state.game.id, null);
  }

  await writeAppearance(db, {
    target,
    appearance,
    generated: {
      inputMessage: input.inputMessage,
      maxRounds,
      context: {
        task: "update",
        form: input.form,
        worn: input.worn,
        contentVersion: target.state.game.contentVersion,
      },
    },
    notify: true,
    trace: options.trace,
  });
  return turnResult(db, target.state.game.id, appearance);
}

/**
 * 维护性重推：任务与 `updateAppearance` 相同，但不写变化事件。
 *
 * 重推的输入没变、结果也不该变，它不是世界里发生的事实；往记忆里贴一条「外观变了」
 * 只会让下一次回合读到假事件。批量维护走这里。
 */
export async function rebuildAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceResult> {
  const target = await loadAppearanceTarget(db, gameRef, actorRef);
  const input = buildAppearanceUpdateInput(target.actor);
  const maxRounds = options.maxRounds ?? DEFAULT_APPEARANCE_MAX_ROUNDS;

  const appearance = await renderAppearance({
    target,
    inputMessage: input.inputMessage,
    maxRounds,
    options,
  });
  if (appearance === null) {
    return turnResult(db, target.state.game.id, null);
  }

  await writeAppearance(db, {
    target,
    appearance,
    generated: {
      inputMessage: input.inputMessage,
      maxRounds,
      context: {
        task: "update",
        form: input.form,
        worn: input.worn,
        contentVersion: target.state.game.contentVersion,
      },
    },
    notify: false,
    trace: options.trace,
  });
  return turnResult(db, target.state.game.id, appearance);
}

/**
 * 死者的外观：以刷新前的当前外观为底，叠加死亡痕迹。
 *
 * 只由死亡阶段调用；「只跑一次」由调用方的收尾标记保证。不写变化事件——宣布阶段
 * 已经通知过全场与死者自己，再贴一条只是同一个事实说两遍。
 */
export async function refreshCorpseAppearance(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: AppearanceOptions,
): Promise<AppearanceResult> {
  const target = await loadAppearanceTarget(db, gameRef, actorRef);
  const input = buildAppearanceDeathInput(target.actor, target.actor.appearance.text);
  const maxRounds = options.maxRounds ?? DEFAULT_APPEARANCE_MAX_ROUNDS;

  const appearance = await renderAppearance({
    target,
    inputMessage: input.inputMessage,
    maxRounds,
    options,
  });
  if (appearance === null) {
    return turnResult(db, target.state.game.id, null);
  }

  await writeAppearance(db, {
    target,
    appearance,
    generated: {
      inputMessage: input.inputMessage,
      maxRounds,
      context: {
        task: "death",
        form: input.form,
        worn: input.worn,
        base: input.base,
        contentVersion: target.state.game.contentVersion,
      },
    },
    notify: false,
    trace: options.trace,
  });
  return turnResult(db, target.state.game.id, appearance);
}

/** 一次外观推理要读的全部东西：状态、当事人、所在场景、世界面名字表与它的记忆。 */
type AppearanceTarget = {
  state: GameStateSlice;
  actor: ActorState;
  stage: StageState;
  /** 世界面守卫用的全量角色名：外观里不能出现名字与引用。 */
  actorNames: string[];
  memory: LoadedMemory;
};

async function loadAppearanceTarget(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<AppearanceTarget> {
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
  return { state, actor, stage, actorNames, memory };
}

/**
 * 借当事人的记忆跑一次推理，返回提交的外观文本；没提交或 loop 失败时返回 null。
 *
 * `mutateMessages: false`：这一轮的推理轮次与工具调用都留在副本里，不进 memory。
 */
async function renderAppearance(input: {
  target: AppearanceTarget;
  inputMessage: string;
  maxRounds: number;
  options: AppearanceOptions;
}): Promise<string | null> {
  const { target, inputMessage, maxRounds, options } = input;
  const tool = buildSubmitAppearanceTool();
  let submitted: string | null = null;

  const loop = await agentLoop({
    name: target.actor.name,
    inputMessage,
    messages: target.memory.messages,
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (submitted !== null) {
          throw new GameError("invalid_action", "外观已提交");
        }
        submitted = parseAppearance(args, target.actorNames);
        return "外观已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  return loop.success ? submitted : null;
}

/**
 * 写回一条当前外观：旧记录标为已取代、递增 game version；`notify` 时再写两条变化事件。
 *
 * 外观变化是可见事实：自己一条用「你」，旁人各一条用观察者相对的引用，都不带真名。
 */
async function writeAppearance(
  db: Database,
  input: {
    target: AppearanceTarget;
    appearance: string;
    /** 这次生成用的输入，原样进审计快照。 */
    generated: { inputMessage: string; maxRounds: number; context: AppearanceContext };
    notify: boolean;
    trace?: TraceContext;
  },
): Promise<void> {
  const { target, appearance, generated, notify, trace } = input;
  const { state, actor, stage, memory } = target;
  const now = new Date();

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
        source: "runtime",
        // provider 契约尚未暴露模型名；先留空，不为审计改 LLM 基建。
        model: null,
        prompt: {
          messages: memory.messages,
          inputMessage: generated.inputMessage,
          tools: [buildSubmitAppearanceTool()],
          maxRounds: generated.maxRounds,
        },
        context: generated.context,
      },
      now,
    });
    if (notify) {
      // 外观已写库：渲染取到的是新值。自己看是「你」，旁人看是观察者相对的引用。
      await appendSelfObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        appearanceChangeText("你", appearance),
        {},
        trace,
      );
      await appendCustomStageObservation(
        tx,
        state.game.id,
        stage.id,
        actor.id,
        (_observerId, address) => renderAppearanceChange(address(actor.id), appearance, stage.id),
        trace,
      );
    }
    await bumpGameVersion(tx, state.game.id, now);
  });
}

/** 外观任务的结果：`appearance` 为 null 即这次没有生成成功。 */
async function turnResult(
  db: Database,
  gameId: string,
  appearance: string | null,
): Promise<AppearanceResult> {
  return {
    ok: appearance !== null,
    appearance,
    ...(await readTurnDelivery(db, gameId)),
  };
}

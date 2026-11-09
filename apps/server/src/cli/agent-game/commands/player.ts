/**
 * 玩家接管与单动作提交：`take-control` / `release-control` / `player-*`。
 *
 * 接管后用某个 actor 的身份直接提交一个动作，绕过计划 loop；需要外观一致性的动作
 * 显式带上 `DEEPSEEK_SERVICE`，与 NPC 回合保持同一条「规划 + 外观」路径。
 */

import type { Command } from "commander";
import { z } from "zod";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import {
  findActorByRef,
  getGameStateSlice,
  playerAnnounce,
  playerBrawl,
  playerCall,
  playerEquip,
  playerGive,
  playerInspect,
  playerLoot,
  playerMove,
  playerPickup,
  playerRecallRoute,
  playerRecognizeIdentity,
  playerSay,
  playerSteal,
  playerStrike,
  playerTeleport,
  playerUnequip,
  playerUse,
  playerWait,
  playerWhisper,
  releaseActorControl,
  takeActorControl,
} from "../../../game";
import { visitedStagesForActor } from "../../../game/actor-state";
import type { ActorTurnResult } from "../../../game/types";
import { EQUIPMENT_SLOTS } from "../../../game/types";
import {
  actorOption,
  actorRef,
  choiceOption,
  gameOption,
  gameRef,
  itemName,
  nonEmptyText,
  optionalOption,
  requiredOption,
} from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

const GROUP = "玩家动作";

const gameAndActor = { game: gameRef, actor: actorRef };

/** 行动回合的统一输出：计划、结算后的状态，死亡阶段有结果时一并带出。 */
function turnOutput(result: ActorTurnResult): Record<string, unknown> {
  return {
    plan: result.plan,
    state: result.state,
    ...(result.death === undefined ? {} : { death: result.death }),
  };
}

const reasonOption = () => optionalOption("--reason <text>", "记入记忆的理由");

const messageOption = () => requiredOption("--message <text>", "内容文本");

const targetOption = (flags = "--target <actorName>", description = "目标 actor 名称") =>
  requiredOption(flags, description);

const itemOption = () => requiredOption("--item <name>", "物品名");

const slotOption = () =>
  choiceOption("--slot <slot>", `装备槽：${EQUIPMENT_SLOTS.join(" / ")}`, EQUIPMENT_SLOTS);

const controlInput = z.object({ ...gameAndActor });

const talkInput = z.object({
  ...gameAndActor,
  target: actorRef,
  message: nonEmptyText("--message"),
  reason: z.string().trim().min(1).optional(),
});

const moveInput = z.object({
  ...gameAndActor,
  to: nonEmptyText("--to <stageId|stageName>"),
});

const targetInput = z.object({ ...gameAndActor, target: actorRef });

const pickupInput = z.object({
  ...gameAndActor,
  anchor: z.string().trim().min(1, "需要 --anchor <label>"),
  item: itemName,
});

const targetItemInput = z.object({ ...gameAndActor, target: actorRef, item: itemName });

/** 搜刮不传 `--item` 就是搬空尸体：列表可重复给，也可一次给多个名字。 */
const lootInput = z.object({
  ...gameAndActor,
  target: actorRef,
  item: z.array(z.string().trim().min(1)).optional(),
});

const useInput = z
  .object({
    ...gameAndActor,
    item: itemName,
    target: z.string().trim().min(1).optional(),
    stage: z.string().trim().min(1).optional(),
    anchor: z.string().trim().min(1).optional(),
  })
  .refine((input) => (input.target === undefined) !== (input.stage === undefined), {
    message: "player-use 需要 --target 或 --stage 二选一",
  })
  .refine((input) => input.anchor === undefined || input.stage !== undefined, {
    message: "player-use 的 --anchor 只能与 --stage 一起使用",
  });

const slotInput = z.object({
  ...gameAndActor,
  slot: z.enum(EQUIPMENT_SLOTS),
});

const equipInput = z.object({
  ...gameAndActor,
  item: itemName,
  slot: z.enum(EQUIPMENT_SLOTS),
});

const recognizeInput = z.object({
  ...gameAndActor,
  target: actorRef,
  as: nonEmptyText("--as <name>"),
});

export function registerPlayerCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "take-control",
    group: GROUP,
    summary: "把 actor 标记为玩家接管",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, ctx) => ({
      result: await ctx.db((db) => takeActorControl(db, input.game, input.actor)),
    }),
  });

  addCommand(program, ctx, {
    name: "release-control",
    group: GROUP,
    summary: "解除玩家接管",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, ctx) => {
      await ctx.db((db) => releaseActorControl(db, input.game, input.actor));
      return { result: { released: true } };
    },
  });

  addCommand(program, ctx, {
    name: "player-say",
    group: GROUP,
    summary: "对同场景目标说一句（占一个行动）",
    options: [gameOption(), actorOption(), targetOption(), messageOption(), reasonOption()],
    schema: talkInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerSay(db, input.game, input.actor, {
            message: input.message,
            targetActorRef: input.target,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-whisper",
    group: GROUP,
    summary: "私语：只有目标听见",
    options: [gameOption(), actorOption(), targetOption(), messageOption(), reasonOption()],
    schema: talkInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerWhisper(db, input.game, input.actor, {
            message: input.message,
            targetActorRef: input.target,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-announce",
    group: GROUP,
    summary: "对全场宣告",
    options: [gameOption(), actorOption(), messageOption(), reasonOption()],
    schema: talkInput.omit({ target: true }),
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerAnnounce(db, input.game, input.actor, {
            message: input.message,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-call",
    group: GROUP,
    summary: "跨场景传音：双方需会 call，目标必须用真名",
    options: [
      gameOption(),
      actorOption(),
      targetOption("--target <trueName>", "目标的真名"),
      messageOption(),
      reasonOption(),
    ],
    schema: talkInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerCall(db, input.game, input.actor, {
            message: input.message,
            targetActorName: input.target,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-move",
    group: GROUP,
    summary: "移动到相邻场景",
    options: [gameOption(), actorOption(), requiredOption("--to <ref>", "stageId 或 stageName")],
    schema: moveInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) => playerMove(db, input.game, input.actor, { targetStageRef: input.to })),
      ),
  });

  addCommand(program, ctx, {
    name: "player-teleport",
    group: GROUP,
    summary: "瞬移到任意场景（不校验相邻）",
    options: [gameOption(), actorOption(), requiredOption("--to <ref>", "stageId 或 stageName")],
    schema: moveInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerTeleport(db, input.game, input.actor, { targetStageRef: input.to }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-wait",
    group: GROUP,
    summary: "原地等待一个行动",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, ctx) =>
      turnOutput(await ctx.db((db) => playerWait(db, input.game, input.actor))),
  });

  addCommand(program, ctx, {
    name: "player-strike",
    group: GROUP,
    summary: "用 weapon 槽的武器攻击目标",
    options: [gameOption(), actorOption(), targetOption()],
    schema: targetInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerStrike(
            db,
            input.game,
            input.actor,
            { targetActorRef: input.target },
            { service: DEEPSEEK_SERVICE, appearanceService: DEEPSEEK_SERVICE },
          ),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-brawl",
    group: GROUP,
    summary: "空手攻击目标（不读物品）",
    options: [gameOption(), actorOption(), targetOption()],
    schema: targetInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerBrawl(
            db,
            input.game,
            input.actor,
            { targetActorRef: input.target },
            { appearanceService: DEEPSEEK_SERVICE },
          ),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-steal",
    group: GROUP,
    summary: "从目标身上偷一件物品",
    options: [gameOption(), actorOption(), targetOption(), itemOption()],
    schema: targetItemInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerSteal(db, input.game, input.actor, {
            targetActorRef: input.target,
            itemName: input.item,
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-inspect",
    group: GROUP,
    summary: "查看目标随身携带的全部物品（占一次行动；察觉看敏捷）",
    options: [gameOption(), actorOption(), targetOption()],
    schema: targetInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerInspect(db, input.game, input.actor, { targetActorRef: input.target }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-loot",
    group: GROUP,
    summary: "搜刮同场景的尸体；不给 --item 就搜刮全部",
    options: [
      gameOption(),
      actorOption(),
      targetOption(),
      optionalOption("--item <names...>", "要搜刮的物品名；省略表示搜刮全部"),
    ],
    schema: lootInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerLoot(db, input.game, input.actor, {
            targetActorRef: input.target,
            ...(input.item === undefined ? {} : { itemNames: input.item }),
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-give",
    group: GROUP,
    summary: "把自己的物品给目标",
    options: [gameOption(), actorOption(), targetOption(), itemOption()],
    schema: targetItemInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerGive(db, input.game, input.actor, {
            targetActorRef: input.target,
            itemName: input.item,
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-pickup",
    group: GROUP,
    summary: "从当前场景的锚点上拾取物品",
    options: [
      gameOption(),
      actorOption(),
      optionalOption("--anchor <label>", "物品所在的锚点标签"),
      itemOption(),
    ],
    schema: pickupInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerPickup(db, input.game, input.actor, {
            targetAnchor: input.anchor,
            itemName: input.item,
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-use",
    group: GROUP,
    summary: "使用物品：对目标 actor、对场景，或落在场景锚点上",
    options: [
      gameOption(),
      actorOption(),
      itemOption(),
      optionalOption("--target <actorName>", "作用目标 actor"),
      optionalOption("--stage <ref>", "作用目标场景（stageId 或 stageName）"),
      optionalOption("--anchor <label>", "场景内的锚点，只能与 --stage 一起用"),
    ],
    schema: useInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerUse(
            db,
            input.game,
            input.actor,
            {
              itemName: input.item,
              ...(input.target === undefined ? {} : { targetActorRef: input.target }),
              ...(input.stage === undefined ? {} : { targetStageName: input.stage }),
              ...(input.anchor === undefined ? {} : { targetAnchor: input.anchor }),
            },
            { service: DEEPSEEK_SERVICE, appearanceService: DEEPSEEK_SERVICE },
          ),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-equip",
    group: GROUP,
    summary: "把物品穿到指定槽位",
    options: [gameOption(), actorOption(), slotOption(), itemOption()],
    schema: equipInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerEquip(
            db,
            input.game,
            input.actor,
            { itemName: input.item, slot: input.slot },
            { appearanceService: DEEPSEEK_SERVICE },
          ),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-unequip",
    group: GROUP,
    summary: "清空指定槽位",
    options: [gameOption(), actorOption(), slotOption()],
    schema: slotInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerUnequip(
            db,
            input.game,
            input.actor,
            { slot: input.slot },
            { appearanceService: DEEPSEEK_SERVICE },
          ),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "player-recognize-identity",
    group: GROUP,
    summary: "把目标记成某个名字（只改自己的记忆，不占行动）",
    options: [
      gameOption(),
      actorOption(),
      targetOption(),
      requiredOption("--as <name>", "自己记下的名字"),
    ],
    schema: recognizeInput,
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerRecognizeIdentity(db, input.game, input.actor, {
            targetActorRef: input.target,
            name: input.as,
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "ask-route",
    group: GROUP,
    summary: "回忆从 A 到 B 怎么走（只写自己的认知，不占行动）",
    options: [
      gameOption(),
      actorOption(),
      optionalOption("--from <name>", "起点场景名，省略则用当前场景"),
      requiredOption("--to <name>", "终点场景名（不接受 #序号）"),
    ],
    schema: z.object({
      ...gameAndActor,
      from: z.string().optional(),
      to: nonEmptyText("--to"),
    }),
    run: async (input, ctx) =>
      turnOutput(
        await ctx.db((db) =>
          playerRecallRoute(db, input.game, input.actor, {
            ...(input.from === undefined ? {} : { fromStageRef: input.from }),
            toStageRef: input.to,
          }),
        ),
      ),
  });

  addCommand(program, ctx, {
    name: "visited-stages",
    group: GROUP,
    summary: "列出 actor 去过的场景",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, ctx) =>
      ctx.db(async (db) => {
        const state = await getGameStateSlice(db, input.game);
        const actor = findActorByRef(state, input.actor);
        return {
          actor: { id: actor.id, name: actor.name },
          visited: visitedStagesForActor(state, actor.id).map((stage) => ({
            stageId: stage.id,
            name: stage.name,
          })),
        };
      }),
  });
}

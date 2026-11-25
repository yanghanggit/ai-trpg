/**
 * 玩家接管与单动作提交：与 `agent-game` 的 `player-*` 一一对应。
 *
 * 服务端只有一个动作入口（`POST /games/:game/actors/:actor/actions`），
 * `kind` 区分动作；命令行的参数形状保持不变，方便两条工作流互换。
 */

import type { Command, Option } from "commander";
import { z } from "zod";
import { EQUIPMENT_SLOTS } from "../../../game/kernel/types";
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
} from "../../args";
import { addApiCommand } from "../command";
import { runTurnJob } from "../jobs";

const GROUP = "玩家动作";

const gameAndActor = { game: gameRef, actor: actorRef };

const message = () => requiredOption("--message <text>", "内容文本");
const reason = () => optionalOption("--reason <text>", "记入记忆的理由");
const target = (flags = "--target <actorName>", description = "目标 actor 名称") =>
  requiredOption(flags, description);
const item = () => requiredOption("--item <name>", "道具名");
const slot = () =>
  choiceOption("--slot <slot>", `装备槽：${EQUIPMENT_SLOTS.join(" / ")}`, EQUIPMENT_SLOTS);

const reasonField = z.string().trim().min(1).optional();
const talkInput = z.object({
  ...gameAndActor,
  target: actorRef,
  message: nonEmptyText("--message"),
  reason: reasonField,
});
const announceInput = z.object({
  ...gameAndActor,
  message: nonEmptyText("--message"),
  reason: reasonField,
});
const controlInput = z.object({ ...gameAndActor });
const targetInput = z.object({ ...gameAndActor, target: actorRef });
const targetItemInput = z.object({ ...gameAndActor, target: actorRef, item: itemName });
const moveInput = z.object({ ...gameAndActor, to: nonEmptyText("--to <stageId|stageName>") });
const pickupInput = z.object({
  ...gameAndActor,
  anchor: nonEmptyText("--anchor <label>"),
  item: itemName,
});
const fitInput = z.object({ ...gameAndActor, item: itemName, anchor: nonEmptyText("--anchor") });
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
const lootInput = z.object({
  ...gameAndActor,
  target: actorRef,
  item: z.array(z.string().trim().min(1)).optional(),
});
const equipInput = z.object({ ...gameAndActor, item: itemName, slot: z.enum(EQUIPMENT_SLOTS) });
const slotInput = z.object({ ...gameAndActor, slot: z.enum(EQUIPMENT_SLOTS) });
const recognizeInput = z.object({
  ...gameAndActor,
  target: actorRef,
  as: nonEmptyText("--as <name>"),
});

type PlayerSpec<T extends z.ZodType> = {
  command: string;
  kind: string;
  summary: string;
  options: Option[];
  schema: T;
  body: (input: z.infer<T>) => Record<string, unknown>;
};

/** 提交一个动作：所有 `player-*` 共用的执行体；一个动作就是一个回合作业。 */
function actionCommand<T extends z.ZodType>(program: Command, spec: PlayerSpec<T>): void {
  addApiCommand(program, {
    name: spec.command,
    group: GROUP,
    summary: spec.summary,
    options: [...spec.options, optionalOption("--expected-version <n>", "执行开始时比对")],
    schema: spec.schema.and(
      z.object({ expectedVersion: z.coerce.number().int().min(0).optional() }),
    ),
    run: async (input, client) => {
      const parsed = input as z.infer<T> & {
        game: string;
        actor: string;
        expectedVersion?: number;
      };
      return {
        job: await runTurnJob(
          client,
          parsed.game,
          `/actors/${encodeURIComponent(parsed.actor)}/actions`,
          {
            action: { kind: spec.kind, ...spec.body(input) },
            ...(parsed.expectedVersion === undefined
              ? {}
              : { expectedVersion: parsed.expectedVersion }),
          },
        ),
      };
    },
  });
}

export function registerPlayerCommands(program: Command): void {
  addApiCommand(program, {
    name: "take-control",
    group: GROUP,
    summary: "把 actor 标记为玩家接管",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/actors/${encodeURIComponent(input.actor)}/control`,
        body: {},
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "release-control",
    group: GROUP,
    summary: "解除玩家接管",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, client) =>
      (await client.call({
        method: "DELETE",
        path: `/games/${encodeURIComponent(input.game)}/actors/${encodeURIComponent(input.actor)}/control`,
      })) as Record<string, unknown>,
  });

  actionCommand(program, {
    command: "player-say",
    kind: "say",
    summary: "对同舞台目标说一句（占一个行动）",
    options: [gameOption(), actorOption(), target(), message(), reason()],
    schema: talkInput,
    body: (input) => ({ target: input.target, message: input.message, reason: input.reason }),
  });

  actionCommand(program, {
    command: "player-whisper",
    kind: "whisper",
    summary: "私语：只有目标听见",
    options: [gameOption(), actorOption(), target(), message(), reason()],
    schema: talkInput,
    body: (input) => ({ target: input.target, message: input.message, reason: input.reason }),
  });

  actionCommand(program, {
    command: "player-announce",
    kind: "announce",
    summary: "对全场宣告",
    options: [gameOption(), actorOption(), message(), reason()],
    schema: announceInput,
    body: (input) => ({ message: input.message, reason: input.reason }),
  });

  actionCommand(program, {
    command: "player-call",
    kind: "call",
    summary: "跨舞台传音：双方需会 call，目标必须用真名",
    options: [
      gameOption(),
      actorOption(),
      target("--target <trueName>", "目标的真名"),
      message(),
      reason(),
    ],
    schema: talkInput,
    body: (input) => ({ target: input.target, message: input.message, reason: input.reason }),
  });

  actionCommand(program, {
    command: "player-move",
    kind: "move",
    summary: "移动到相邻舞台",
    options: [gameOption(), actorOption(), requiredOption("--to <ref>", "stageId 或 stageName")],
    schema: moveInput,
    body: (input) => ({ to: input.to }),
  });

  actionCommand(program, {
    command: "player-teleport",
    kind: "teleport",
    summary: "瞬移到任意舞台（不校验相邻）",
    options: [gameOption(), actorOption(), requiredOption("--to <ref>", "stageId 或 stageName")],
    schema: moveInput,
    body: (input) => ({ to: input.to }),
  });

  actionCommand(program, {
    command: "player-wait",
    kind: "wait",
    summary: "原地等待一个行动",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    body: () => ({}),
  });

  actionCommand(program, {
    command: "player-hide",
    kind: "hide",
    summary: "隐入暗处：旁人不再被动看见你",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    body: () => ({}),
  });

  actionCommand(program, {
    command: "player-reveal",
    kind: "reveal",
    summary: "从暗处现身，让同舞台旁人看见",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    body: () => ({}),
  });

  actionCommand(program, {
    command: "player-strike",
    kind: "strike",
    summary: "用 weapon 槽的武器攻击目标",
    options: [gameOption(), actorOption(), target()],
    schema: targetInput,
    body: (input) => ({ target: input.target }),
  });

  actionCommand(program, {
    command: "player-brawl",
    kind: "brawl",
    summary: "空手攻击目标（不读道具）",
    options: [gameOption(), actorOption(), target()],
    schema: targetInput,
    body: (input) => ({ target: input.target }),
  });

  actionCommand(program, {
    command: "player-steal",
    kind: "steal",
    summary: "从目标身上偷一件道具",
    options: [gameOption(), actorOption(), target(), item()],
    schema: targetItemInput,
    body: (input) => ({ target: input.target, item: input.item }),
  });

  actionCommand(program, {
    command: "player-inspect",
    kind: "inspect",
    summary: "查看目标随身携带的全部道具（占一次行动；察觉看敏捷）",
    options: [gameOption(), actorOption(), target()],
    schema: targetInput,
    body: (input) => ({ target: input.target }),
  });

  actionCommand(program, {
    command: "player-loot",
    kind: "loot",
    summary: "搜刮同舞台的尸体；不给 --item 就搜刮全部",
    options: [
      gameOption(),
      actorOption(),
      target(),
      optionalOption("--item <names...>", "要搜刮的道具名；省略表示搜刮全部"),
    ],
    schema: lootInput,
    body: (input) => ({ target: input.target, items: input.item }),
  });

  actionCommand(program, {
    command: "player-give",
    kind: "give",
    summary: "把自己的道具给目标",
    options: [gameOption(), actorOption(), target(), item()],
    schema: targetItemInput,
    body: (input) => ({ target: input.target, item: input.item }),
  });

  actionCommand(program, {
    command: "player-pickup",
    kind: "pickup",
    summary: "从当前舞台的锚点上拾取道具",
    options: [
      gameOption(),
      actorOption(),
      requiredOption("--anchor <label>", "道具所在的锚点标签"),
      item(),
    ],
    schema: pickupInput,
    body: (input) => ({ anchor: input.anchor, item: input.item }),
  });

  actionCommand(program, {
    command: "player-use",
    kind: "use",
    summary: "使用道具：对目标 actor、对舞台，或落在舞台锚点上",
    options: [
      gameOption(),
      actorOption(),
      item(),
      optionalOption("--target <actorName>", "作用目标 actor"),
      optionalOption("--stage <ref>", "作用目标舞台（stageId 或 stageName）"),
      optionalOption("--anchor <label>", "舞台内的锚点，只能与 --stage 一起用"),
    ],
    schema: useInput,
    body: (input) => ({
      item: input.item,
      target: input.target,
      stage: input.stage,
      anchor: input.anchor,
    }),
  });

  actionCommand(program, {
    command: "player-fit",
    kind: "fit",
    summary: "对上：把一件自己带着的道具对上当前舞台的一个锚点",
    options: [
      gameOption(),
      actorOption(),
      item(),
      requiredOption("--anchor <label>", "要对上的锚点标签"),
    ],
    schema: fitInput,
    body: (input) => ({ item: input.item, anchor: input.anchor }),
  });

  actionCommand(program, {
    command: "player-equip",
    kind: "equip",
    summary: "把道具穿到指定槽位",
    options: [gameOption(), actorOption(), slot(), item()],
    schema: equipInput,
    body: (input) => ({ item: input.item, slot: input.slot }),
  });

  actionCommand(program, {
    command: "player-unequip",
    kind: "unequip",
    summary: "清空指定槽位",
    options: [gameOption(), actorOption(), slot()],
    schema: slotInput,
    body: (input) => ({ slot: input.slot }),
  });

  actionCommand(program, {
    command: "player-recognize-identity",
    kind: "recognize-identity",
    summary: "把目标记成某个名字（只改自己的记忆，不占行动）",
    options: [
      gameOption(),
      actorOption(),
      target(),
      requiredOption("--as <name>", "自己记下的名字"),
    ],
    schema: recognizeInput,
    body: (input) => ({ target: input.target, name: input.as }),
  });

  actionCommand(program, {
    command: "ask-route",
    kind: "ask-route",
    summary: "回忆从 A 到 B 怎么走（只写自己的认知，不占行动）",
    options: [
      gameOption(),
      actorOption(),
      optionalOption("--from <name>", "起点舞台名，省略则用当前舞台"),
      requiredOption("--to <name>", "终点舞台名（不接受 #序号）"),
    ],
    schema: z.object({
      ...gameAndActor,
      from: z.string().trim().min(1).optional(),
      to: nonEmptyText("--to"),
    }),
    body: (input) => ({ from: input.from, to: input.to }),
  });

  addApiCommand(program, {
    name: "visited-stages",
    group: GROUP,
    summary: "列出 actor 去过的舞台",
    options: [gameOption(), actorOption()],
    schema: controlInput,
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/actors/${encodeURIComponent(input.actor)}/visited-stages`,
      })) as Record<string, unknown>,
  });
}

import type { TraceContext } from "../../debug/trace";
import { type AddressLookup, actionRef } from "../addressing";
import { damageActionText } from "../observation-text";
import { appendDamageObservations, appendStageMemory } from "../observations";
import { damageActor } from "../persistence/actors";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../persistence/rows";

/** 一次命中属于哪个动作；只影响文案，不影响结算。 */
export type HitAction = "strike" | "cleave" | "brawl" | "use";

/** 一次命中落账后的实际结果；供需要知道“打掉多少、是否打死”的上层使用。 */
export type HitOutcome = {
  feedback: string;
  /** 实际扣除的 HP，按目标剩余生命截断；目标已死或伤害为 0 时为 0。 */
  dealtDamage: number;
  /** 这次命中是否让目标 HP 归零。 */
  targetDied: boolean;
};

export type HitInput = {
  executor: Executor;
  gameId: string;
  actorRow: ActorWithStageRow;
  stage: StageRow;
  target: ActorRow;
  /** 已经算好的最终伤害；调用方负责换算与减伤（见 `mitigatedDamage`）。 */
  damage: number;
  action: HitAction;
  itemName?: string;
  /** 词缀追加的伤害；默认效果省略。 */
  via?: "affix";
  now: Date;
  address?: AddressLookup;
  trace?: TraceContext;
};

/**
 * 中立的伤害写入器：扣血、公共消息、伤害观察、场景记忆、行动反馈。
 *
 * 它不知道"物品"或"词缀"，只处理一次已经算好的命中；因此 `brawl` 与物品管线
 * 共用同一条落账路径，不会出现两套死亡/观察文案。
 */
export async function applyHit(input: HitInput): Promise<HitOutcome> {
  const { executor, gameId, actorRow, stage, target, damage, action, itemName, via, now, trace } =
    input;
  // 连续结算同一个目标：扣血走带行锁的读-改-写，不拿旧快照覆盖。
  // 这里只写 hp：「是否死亡」由死亡阶段按 hp 派生，结算方不判定死亡，
  // 也就不会漏掉其它写 hp 的路径。
  const hit = await damageActor(executor, target.id, damage, now);
  if (hit.status === "missing") {
    throw new Error(`目标不存在: ${target.name}`);
  }
  const current = hit.row;
  const ref = (address: AddressLookup | undefined) =>
    address ? actionRef(address(target.id)) : target.name;
  if (hit.status === "already-dead") {
    return {
      feedback: `# 行动结果\n${ref(input.address)}已经倒下。`,
      dealtDamage: 0,
      targetDied: false,
    };
  }
  const remainingHp = hit.remainingHp;
  const dealtDamage = current.hp - remainingHp;
  const targetDied = remainingHp <= 0;
  await bumpGameVersion(executor, gameId, now);

  // 公共消息是上帝视角：句首与结局都用名字，不混入观察者相对的引用。
  const outcome =
    remainingHp <= 0
      ? `；${target.name}倒下了。`
      : `；${target.name}剩余 HP ${remainingHp}/${current.stats.maxHp}。`;
  // 句式由动作锁定：公共消息、舞台记忆、观察与反馈用的是同一个动作短语。
  const actionText = damageActionText(action, itemName);
  const damageText = via === "affix" ? `词缀追加${damage}点伤害` : `造成${damage}点伤害`;
  const content = `${actorRow.actor.name}对${target.name}${actionText}，${damageText}${outcome}`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: action,
    stageId: stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  await appendDamageObservations(
    executor,
    gameId,
    stage,
    {
      action,
      attacker: { id: actorRow.actor.id },
      target: { id: target.id, maxHp: current.stats.maxHp },
      ...(itemName ? { itemName } : {}),
      damage,
      remainingHp,
      ...(via ? { via } : {}),
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    stage.id,
    `# 场景事件\n${content}`,
    { eventKind: action, targetActorId: target.id },
    trace,
  );
  // 出手者只知道这一下打得多重、对方有没有倒下；对方剩余生命只写进公共消息（上帝视角）
  // 与受害者自己，不进出手者的记忆。
  const feedback = `你对${ref(input.address)}${actionText}，${damageText}`;
  return {
    feedback: `# 行动结果\n${feedback}${targetDied ? `；${ref(input.address)}倒下了` : ""}。`,
    dealtDamage,
    targetDied,
  };
}

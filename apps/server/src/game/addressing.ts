import { plainEntityName } from "./entity-name";
import type { ActorState, GameState, StageState } from "./types";

export { plainEntityName };

/**
 * 观察者相对的指代（address）。
 *
 * 名字是知识、不是地址：同一个 actor 在不同观察者眼里有不同的称呼，没被告知姓名时只剩
 * 外观。`token`（`@<形象序号>`）是系统给本轮用的不透明指代，稳定、不含真名，不得出现在
 * 台词里。
 */

export type Address = {
  /** 系统指代，如 `@3`；找不到主体时为空串。 */
  token: string;
  /** 名单里的完整写法：`名字（外观）` 或只有外观。 */
  label: string;
  /** 句子里的自然称呼：知道名字就用名字，否则只用外观。 */
  mention: string;
  /** 观察者相信的名字；未知为 null。 */
  knownName: string | null;
};

/** 按 actorId 取该观察者视角下的指代。 */
export type AddressLookup = (actorId: string) => Address;

/** 构建指代所需的最小主体数据：身份、当前形象与可见外观。 */
export type AddressSubject = {
  actorId: string;
  presentationId: string;
  presentationSeq: number;
  appearance: string;
};

const UNKNOWN_LABEL = "一个看不清的身影";

/** 形象序号就是句柄；与 actor / stage / item 共用本局实体序号。 */
export function handleOf(presentationSeq: number): string {
  return `@${presentationSeq}`;
}

/** 句柄的形状；台词里出现它说明模型把系统指代当成了称呼。 */
export const HANDLE_PATTERN = /@\d+/;

/**
 * 物品/实体名匹配：全名与去掉类型前缀的写法都接受。
 *
 * 内容里仍用全名（`武器.某物`）保证唯一；角色看到的是去掉前缀的写法。
 */
export function entityNameMatches(candidate: string, ref: string): boolean {
  return candidate === ref || plainEntityName(candidate) === ref;
}

function labelOf(knownName: string | null, appearance: string): string {
  return knownName === null ? appearance : `${knownName}（${appearance}）`;
}

/**
 * 用「观察者已知的名字」+「主体当前形象」拼出指代。
 *
 * 名字只按形象 id 查：换了形象就等于换了对象，旧名字不会自动跟过去。
 */
export function makeAddressLookup(
  knownNames: ReadonlyMap<string, string>,
  subjects: ReadonlyMap<string, AddressSubject>,
): AddressLookup {
  return (actorId) => {
    const subject = subjects.get(actorId);
    if (!subject) {
      return {
        token: "",
        label: UNKNOWN_LABEL,
        mention: UNKNOWN_LABEL,
        knownName: null,
      };
    }
    const knownName = knownNames.get(subject.presentationId) ?? null;
    return {
      token: handleOf(subject.presentationSeq),
      label: labelOf(knownName, subject.appearance),
      mention: knownName ?? subject.appearance,
      knownName,
    };
  };
}

/** 名单里的指代：`@3 某人（此刻裹着斗篷）`。 */
export function refOf(address: Address): string {
  return address.token.length === 0 ? address.label : `${address.token} ${address.label}`;
}

/** 句子里的自然称呼：知道名字就写名字，否则只写外观。 */
export function mentionOf(address: Address): string {
  return address.mention;
}

/** 行动反馈里的指代：带上句柄，方便下一轮直接引用。 */
export function actionRef(address: Address): string {
  return address.token.length === 0 ? address.mention : `${address.token} ${address.mention}`;
}

/** 一组 actor 的当前形象；未提供时应视为不可见。 */
export function subjectsOf(stage: StageState): Map<string, AddressSubject> {
  return new Map(
    stage.actors.map((actor) => [
      actor.id,
      {
        actorId: actor.id,
        presentationId: actor.presentation.id,
        presentationSeq: actor.presentation.seq,
        appearance: actor.appearance,
      },
    ]),
  );
}

function knownNamesOf(state: GameState, observerActorId: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of state.knowledge) {
    if (row.observerActorId === observerActorId) {
      names.set(row.presentationId, row.name);
    }
  }
  return names;
}

/**
 * actor 视角的指代表：主体取本场景的全部角色。
 *
 * 自己的指代固定为「你自己」，名字是自己的知识，不占用名字表。
 */
export function addressLookupFor(
  state: GameState,
  observer: ActorState,
  stage: StageState,
): AddressLookup {
  const lookup = makeAddressLookup(knownNamesOf(state, observer.id), subjectsOf(stage));
  return (actorId) => {
    if (actorId === observer.id) {
      return {
        token: handleOf(observer.presentation.seq),
        label: "你自己",
        mention: "你",
        knownName: observer.name,
      };
    }
    return lookup(actorId);
  };
}

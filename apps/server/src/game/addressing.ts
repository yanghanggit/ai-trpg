import type { ActorState, GameState, StageState } from "./types";

/**
 * 观察者相对的引用（address）。
 *
 * 名字是知识、不是地址：同一个 actor 在不同观察者眼里有不同的称呼，没被告知姓名时只剩
 * 外观。引用只有两种写法：
 *
 * - `@名字`：你知道他是谁；
 * - `#12`：你还不知道他叫什么，只能靠外观辨认。
 *
 * 两者都是系统标记，不得出现在台词里。
 */

export type Address = {
  /** 引用写法：`@名字` 或 `#12`；找不到主体时为空串。 */
  token: string;
  /** 名单写法：`名字（外观）` / `外观：…`。 */
  label: string;
  /** 句子里的引用：`token`；自己固定为「你」。 */
  mention: string;
  /** 当前形象的外观；句子不内联它，需要时由 `appearanceLine` 单独成行。 */
  appearance: string;
  /** 观察者相信的名字；未知为 null。 */
  knownName: string | null;
  /** 是否为观察者自己。 */
  isSelf: boolean;
};

/** 按 actorId 取该观察者视角下的引用。 */
export type AddressLookup = (actorId: string) => Address;

/** 构建引用所需的最小主体数据：身份、当前形象与可见外观。 */
export type AddressSubject = {
  actorId: string;
  presentationId: string;
  presentationSeq: number;
  appearance: string;
};

/** 引用无法解析（对方不在本场景）时的泛称：不可观测，也不编造外观。 */
const UNKNOWN_LABEL = "某个不在场者";

/** 不知道名字时的匿名编号；与 actor / stage / item 共用本局实体序号。 */
export function handleOf(presentationSeq: number): string {
  return `#${presentationSeq}`;
}

/** 匿名编号的形状；台词里出现它说明模型把引用当成了称呼。 */
export const HANDLE_PATTERN = /#\d+/;

/** 名字引用的形状：`@名字`，在空白与标点处截断。 */
export const NAME_REF_PATTERN = /@\S*/;

/** 参数归一：名字类参数允许带一个前导 `@`；`#编号` 与纯名字原样返回。 */
export function stripNameRef(ref: string): string {
  return ref.startsWith("@") ? ref.slice(1) : ref;
}

/** 名单里的引用：`@某甲（外观）` / `#12 外观：…`。 */
export function refOf(address: Address): string {
  if (address.token.length === 0) {
    return address.label;
  }
  return address.knownName === null ? `${address.token} ${address.label}` : `@${address.label}`;
}

/** 句子里的引用。 */
export function mentionOf(address: Address): string {
  return address.mention;
}

/** 未知名字时补充的外观行：`#12 外观：…`；已知名字返回 null。 */
export function appearanceLine(address: Address): string | null {
  if (address.knownName !== null || address.appearance.length === 0) {
    return null;
  }
  return `${address.token} 外观：${address.appearance}`;
}

/** 行动反馈里的引用：自己写作「你自己」。 */
export function actionRef(address: Address): string {
  return address.isSelf ? "你自己" : address.mention;
}

/**
 * 用「观察者已知的名字」+「主体当前形象」拼出引用。
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
        appearance: "",
        knownName: null,
        isSelf: false,
      };
    }
    const knownName = knownNames.get(subject.presentationId) ?? null;
    const token = knownName === null ? handleOf(subject.presentationSeq) : `@${knownName}`;
    return {
      token,
      label:
        knownName === null
          ? `外观：${subject.appearance}`
          : `${knownName}（${subject.appearance}）`,
      mention: token,
      appearance: subject.appearance,
      knownName,
      isSelf: false,
    };
  };
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
 * actor 视角的引用表：主体取本场景的全部角色。
 *
 * 自己的引用固定为「你」，名字是自己的知识，不占用名字表。
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
        token: `@${observer.name}`,
        label: "你自己",
        mention: "你",
        appearance: observer.appearance,
        knownName: observer.name,
        isSelf: true,
      };
    }
    return lookup(actorId);
  };
}

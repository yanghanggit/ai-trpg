import { handleOf, isHandleRef } from "./reference";
import type { ActorState, GameStateSlice, StageState } from "./types";

/**
 * 观察者相对的引用：有名字就写名字，没有（或分不开）就写 `#序号`，并带上外观。
 *
 * 名字就是地址：观察者当前怎么称呼一个签名，就怎么写它。只有名字不能当地址时才退回编号，
 * 见 `docs/glossary.md`、`docs/information-disclosure.md`。字符串语法（`#12`、旧版 `@`）
 * 统一在 `reference.ts`，这里只负责观察者投影。
 */

export type Address = {
  /** 可提交的地址：观察者当前的称呼，或 `#12`；找不到主体时为空串。 */
  token: string;
  /** 当前签名的外观；句子不内联它，需要时由 `appearanceLine` 单独成行。 */
  appearance: string;
  /** 是否为观察者自己。 */
  isSelf: boolean;
  /** 名字退回编号时保留观察者的称呼，只用于展示（`refOf`），不是可提交的地址。 */
  knownName?: string;
};

/** 按 actorId 取该观察者视角下的引用。 */
export type AddressLookup = (actorId: string) => Address;

/** 构建引用所需的最小主体数据：签名与可见外观；不携带真名。 */
export type AddressSubject = {
  signatureId: string;
  signatureSeq: number;
  appearance: string;
};

/** 引用无法解析（对方不在本场景）时的泛称：不可观测，也不编造外观。 */
export const UNKNOWN_LABEL = "某个不在场者";

/**
 * 名单与工具结果的展示写法：`名字（外观）` / `#12 外观：…`。
 *
 * 名字退回编号时，观察者的称呼附在后面（`#12 外观：…｜你的称呼：父亲`）——
 * 那是认知，不是地址；能直接提交的永远是 `address.token`。
 */
export function refOf(address: Address): string {
  if (address.isSelf) {
    return "你自己";
  }
  if (address.token.length === 0) {
    return UNKNOWN_LABEL;
  }
  const described = isHandleRef(address.token)
    ? `${address.token} 外观：${address.appearance}`
    : `${address.token}（${address.appearance}）`;
  return address.knownName === undefined
    ? described
    : `${described}｜你的称呼：${address.knownName}`;
}

/** 句子里的引用；自己写作「你」。 */
export function mentionOf(address: Address): string {
  if (address.isSelf) {
    return "你";
  }
  return address.token.length > 0 ? address.token : UNKNOWN_LABEL;
}

/**
 * 观察末尾的外观行：名字可能是误认，外观更稳，两者一起写；自己的外观不重复成行。
 */
export function appearanceLine(address: Address): string | null {
  if (address.isSelf || address.appearance.length === 0) {
    return null;
  }
  return refOf(address);
}

/** 行动反馈里的引用：自己写作「你自己」。 */
export function actionRef(address: Address): string {
  return address.isSelf ? "你自己" : mentionOf(address);
}

/**
 * 用「观察者当前给签名的名字」+「签名外观」拼出引用。
 *
 * 这里不判定任何可见性：主体表里有谁，就只渲染谁。名字重名时不能产出两个同形地址，
 * 这些主体退回 `#编号`，但名字仍作为 `knownName` 保留——观察者确实认得他们，
 * 只是这个称呼不能当地址用。`reservedNames` 把观察者自己的名字也算进冲突，
 * 避免别人的称呼和 `自己` 撞车。
 */
export function makeAddressLookup(
  names: ReadonlyMap<string, string>,
  subjects: ReadonlyMap<string, AddressSubject>,
  reservedNames: readonly string[] = [],
): AddressLookup {
  const counts = new Map<string, number>();
  for (const name of reservedNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const subject of subjects.values()) {
    const name = names.get(subject.signatureId);
    if (name !== undefined) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return (actorId) => {
    const subject = subjects.get(actorId);
    if (!subject) {
      return { token: "", appearance: "", isSelf: false };
    }
    const name = names.get(subject.signatureId);
    if (name !== undefined && counts.get(name) === 1) {
      return { token: name, appearance: subject.appearance, isSelf: false };
    }
    return {
      token: handleOf(subject.signatureSeq),
      appearance: subject.appearance,
      isSelf: false,
      ...(name === undefined ? {} : { knownName: name }),
    };
  };
}

/** 一组 actor 的当前签名；未提供时应视为不可见。 */
export function subjectsOf(stage: StageState): Map<string, AddressSubject> {
  return new Map(
    stage.actors.map((actor) => [
      actor.id,
      {
        signatureId: actor.signature.id,
        signatureSeq: actor.signature.seq,
        appearance: actor.appearance.text,
      },
    ]),
  );
}

/** 观察者给自己与在场者拼引用所需的最小投影；不携带真名。 */
export type AddressSelf = {
  id: string;
  name: string;
  appearance: string;
};

/**
 * 给 base 补上 self 语义：自己的地址固定是真名，`isSelf` 为 true。
 *
 * 必须与 `reservedNames: [self.name]` 成对使用——真名被自己占走，
 * 别人的同名称呼才会退回 `#编号`。调用方不再自己判 `actorId === self.id`。
 */
export function withSelf(base: AddressLookup, self: AddressSelf): AddressLookup {
  return (actorId) =>
    actorId === self.id
      ? { token: self.name, appearance: self.appearance, isSelf: true }
      : base(actorId);
}

/**
 * 每份状态快照的「观察者 → 签名 id → 称呼」索引。
 *
 * 一轮渲染里 `addressLookupFor` 会被调用多次（回合输入、look 工具、view 各一次），
 * 每次都全表扫 `signatureNames` 是纯浪费。索引挂在 state 对象上，随快照回收。
 */
const nameIndexCache = new WeakMap<GameStateSlice, Map<string, Map<string, string>>>();

/** 没有任何称呼的观察者共享这一份；调用方只读。 */
const EMPTY_NAMES: ReadonlyMap<string, string> = new Map<string, string>();

function nameIndex(state: GameStateSlice): Map<string, Map<string, string>> {
  const cached = nameIndexCache.get(state);
  if (cached) {
    return cached;
  }
  const index = new Map<string, Map<string, string>>();
  for (const row of state.signatureNames) {
    const names = index.get(row.observerActorId);
    if (names) {
      names.set(row.signatureId, row.name);
    } else {
      index.set(row.observerActorId, new Map([[row.signatureId, row.name]]));
    }
  }
  nameIndexCache.set(state, index);
  return index;
}

/** 观察者当前给各签名的名字；名字只按签名 id 绑定。 */
function signatureNamesOf(
  state: GameStateSlice,
  observerActorId: string,
): ReadonlyMap<string, string> {
  return nameIndex(state).get(observerActorId) ?? EMPTY_NAMES;
}

/** actor 视角的引用表：主体取本场景的全部角色。 */
export function addressLookupFor(
  state: GameStateSlice,
  observer: ActorState,
  stage: StageState,
): AddressLookup {
  return withSelf(
    makeAddressLookup(signatureNamesOf(state, observer.id), subjectsOf(stage), [observer.name]),
    { id: observer.id, name: observer.name, appearance: observer.appearance.text },
  );
}

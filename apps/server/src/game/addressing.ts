import type { ActorState, GameState, StageState } from "./types";

/**
 * 观察者相对的引用：把签名渲染成 `@名字` 或 `#12`，并带上外观。
 *
 * 这里只做渲染，不判断可见范围；命名与认知归属见 `docs/glossary.md`、`docs/information-disclosure.md`。
 */

export type Address = {
  /** 引用写法：`@名字` 或 `#12`；找不到主体时为空串。 */
  token: string;
  /** 当前签名的外观；句子不内联它，需要时由 `appearanceLine` 单独成行。 */
  appearance: string;
  /** 是否为观察者自己。 */
  isSelf: boolean;
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
const UNKNOWN_LABEL = "某个不在场者";

/** 不知道名字时的匿名编号；与 actor / stage / item 共用本局实体序号。 */
export function handleOf(signatureSeq: number): string {
  return `#${signatureSeq}`;
}

/** 匿名编号的形状；台词里出现它说明模型把引用当成了名字。 */
export const HANDLE_PATTERN = /#\d+/;

/** 名字引用的标记：只用于检测 `@`，不负责解析名字边界。 */
export const NAME_REF_PATTERN = /@\S*/;

/** 参数归一：名字类参数允许带一个前导 `@`；`#编号` 与纯名字原样返回。 */
export function stripNameRef(ref: string): string {
  return ref.startsWith("@") ? ref.slice(1) : ref;
}

/**
 * 名单与工具结果的展示写法：`@名字（外观）` / `#12 外观：…`。
 *
 * 只用于阅读，不是 token：可直接提交的地址永远是 `address.token`。
 */
export function refOf(address: Address): string {
  if (address.isSelf) {
    return "你自己";
  }
  if (address.token.length === 0) {
    return UNKNOWN_LABEL;
  }
  return address.token.startsWith("@")
    ? `${address.token}（${address.appearance}）`
    : `${address.token} 外观：${address.appearance}`;
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
 * 名字相同时不能生成两个相同的 `@名字`，这些主体退回 `#编号`；
 * `reservedNames` 用来把观察者自己的名字也算进冲突，避免和 `@自己` 撞车。
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
    const unique = name !== undefined && counts.get(name) === 1;
    return {
      token: unique ? `@${name}` : handleOf(subject.signatureSeq),
      appearance: subject.appearance,
      isSelf: false,
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

/** 观察者当前给各签名的名字；名字只按签名 id 绑定。 */
function signatureNamesOf(state: GameState, observerActorId: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of state.signatureNames) {
    if (row.observerActorId === observerActorId) {
      names.set(row.signatureId, row.name);
    }
  }
  return names;
}

/**
 * actor 视角的引用表：主体取本场景的全部角色。
 *
 * 自己的引用固定为「你」，名字是自己的真名，不占用名字表。
 */
export function addressLookupFor(
  state: GameState,
  observer: ActorState,
  stage: StageState,
): AddressLookup {
  const lookup = makeAddressLookup(signatureNamesOf(state, observer.id), subjectsOf(stage), [
    observer.name,
  ]);
  return (actorId) => {
    if (actorId === observer.id) {
      return {
        token: `@${observer.name}`,
        appearance: observer.appearance.text,
        isSelf: true,
      };
    }
    return lookup(actorId);
  };
}

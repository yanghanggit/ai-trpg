import type { ActorState, GameState, StageState } from "./types";

/**
 * 观察者相对的引用（address）。
 *
 * 名字是真名，只有一种；知道与不知道是二元的：
 *
 * - `@真名`：你认得这具形象，知道他是谁；
 * - `#12`：你还不认得他，只能靠编号与外观辨认。
 *
 * 没有“知道一个别名”的中间态。称号、关系称谓（父王、守钟的）属于设定与台词，
 * 不是地址，也不进入名单与工具参数。
 *
 * 两者都是系统标记，不得出现在台词里。
 */

export type Address = {
  /** 引用写法：`@真名` 或 `#12`；找不到主体时为空串。 */
  token: string;
  /** 名单写法：`名字（外观）` / `外观：…`。 */
  label: string;
  /** 句子里的引用：`token`；自己固定为「你」。 */
  mention: string;
  /** 当前形象的外观；句子不内联它，需要时由 `appearanceLine` 单独成行。 */
  appearance: string;
  /** 是否认得这具形象；认得即知道真名。 */
  known: boolean;
  /** 是否为观察者自己。 */
  isSelf: boolean;
};

/** 按 actorId 取该观察者视角下的引用。 */
export type AddressLookup = (actorId: string) => Address;

/** 构建引用所需的最小主体数据：身份、真名、当前形象与可见外观。 */
export type AddressSubject = {
  actorId: string;
  /** 真名；认得这具形象时，引用只能用它。 */
  name: string;
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

/** 匿名编号的形状；台词里出现它说明模型把引用当成了名字。 */
export const HANDLE_PATTERN = /#\d+/;

/** 名字引用的形状：`@名字`，在空白与标点处截断。 */
export const NAME_REF_PATTERN = /@\S*/;

/** 参数归一：名字类参数允许带一个前导 `@`；`#编号` 与纯名字原样返回。 */
export function stripNameRef(ref: string): string {
  return ref.startsWith("@") ? ref.slice(1) : ref;
}

/**
 * 名单与工具结果的展示写法：`@真名（外观）` / `#12 外观：…`。
 *
 * 只用于阅读，不是 token：可直接提交的地址永远是 `address.token`。
 */
export function refOf(address: Address): string {
  if (address.token.length === 0) {
    return address.label;
  }
  return address.known ? `@${address.label}` : `${address.token} ${address.label}`;
}

/** 句子里的引用。 */
export function mentionOf(address: Address): string {
  return address.mention;
}

/** 未知名字时补充的外观行：`#12 外观：…`；已知名字返回 null。 */
export function appearanceLine(address: Address): string | null {
  if (address.known || address.appearance.length === 0) {
    return null;
  }
  return `${address.token} 外观：${address.appearance}`;
}

/** 行动反馈里的引用：自己写作「你自己」。 */
export function actionRef(address: Address): string {
  return address.isSelf ? "你自己" : address.mention;
}

/**
 * 用「是否认得这具形象」+「主体真名」拼出引用。
 *
 * 认得就一定是真名，不认得就一定是编号；调用方没有机会塞进第三种叫法。
 */
export function makeAddressLookup(
  recognized: ReadonlySet<string>,
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
        known: false,
        isSelf: false,
      };
    }
    const known = recognized.has(subject.presentationId);
    const token = known ? `@${subject.name}` : handleOf(subject.presentationSeq);
    return {
      token,
      label: known ? `${subject.name}（${subject.appearance}）` : `外观：${subject.appearance}`,
      mention: token,
      appearance: subject.appearance,
      known,
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
        name: actor.name,
        presentationId: actor.presentation.id,
        presentationSeq: actor.presentation.seq,
        appearance: actor.appearance,
      },
    ]),
  );
}

/** 观察者认得哪些形象；认识与否只按形象 id 判断，不存称呼。 */
function recognizedPresentationsOf(state: GameState, observerActorId: string): Set<string> {
  const recognized = new Set<string>();
  for (const row of state.recognitions) {
    if (row.observerActorId === observerActorId) {
      recognized.add(row.presentationId);
    }
  }
  return recognized;
}

/**
 * actor 视角的引用表：主体取本场景的全部角色。
 *
 * 自己的引用固定为「你」，名字是自己的真名，不占用识别表。
 */
export function addressLookupFor(
  state: GameState,
  observer: ActorState,
  stage: StageState,
): AddressLookup {
  const lookup = makeAddressLookup(
    recognizedPresentationsOf(state, observer.id),
    subjectsOf(stage),
  );
  return (actorId) => {
    if (actorId === observer.id) {
      return {
        token: `@${observer.name}`,
        label: "你自己",
        mention: "你",
        appearance: observer.appearance,
        known: true,
        isSelf: true,
      };
    }
    return lookup(actorId);
  };
}

import { GameError } from "../../errors";
import { type AddressLookup, appearanceLine, mentionOf, UNKNOWN_LABEL } from "./projection";
import { containsHandle, HANDLE_PATTERN, handleOf, handlesIn, isHandleRef } from "./syntax";

/**
 * 世界面文本的守卫：拦下不该出现在 actor 视野里的地址，并把要写给 actor 的文本脱敏。
 *
 * 模块最上层。三层的关系是「同一套地址规则的三面」：语法（`syntax.ts`）说地址长什么样，
 * 投影（`projection.ts`）说这个观察者该看到哪一个，守卫在这里说它能不能出现。
 *
 * 泄漏检查。
 *
 * `#12` 与角色本名都只属于控制面：它们可以出现在 stage / world 自己的全知记忆里，
 * 但不能进入 actor 能看到的环境、台词或结局文案。名字就是地址，所以这里查的是名字本身，
 * 不再有一种「带标记的引用」需要单独拦。
 */

export type TextLeakCode = "handle" | "actor_name" | "stage_name";

export type TextLeak = {
  code: TextLeakCode;
  token: string;
};

export type TextLeakOptions = {
  /** 为 false 时只查编号，适合“名字本身合法”的 god-view 文本。 */
  actorNames?: boolean;
};

/** 名字要放进正则，先转义。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 找出文本里不应出现在世界面的内容。
 *
 * 场景名、道具名是公共标签，出现在自然叙述里合法；这里只拦编号与角色本名。
 * 场景名的泄漏与否要看连通性，单独走 `findStageNameLeaks`。
 */
export function findTextLeaks(
  text: string,
  actorNames: readonly string[] = [],
  options: TextLeakOptions = {},
): TextLeak[] {
  const found = new Map<string, TextLeak>();
  const add = (code: TextLeakCode, token: string): void => {
    found.set(`${code}:${token}`, { code, token });
  };

  for (const handle of handlesIn(text)) {
    add("handle", handle);
  }
  if (options.actorNames !== false) {
    for (const name of actorNames) {
      if (name.length > 0 && text.includes(name)) {
        add("actor_name", name);
      }
    }
  }
  return [...found.values()];
}

/**
 * 场景名泄漏：相邻场景的真名能不能写进可观察文本，取决于那条边通没通。
 *
 * 「北面的门缠着三圈铁链」这种话本身就是环境；但一句话就把还没打通、演员根本不知道
 * 存在的场景点出来，等于替演员做了发现。所以 environment / 锚点文本只能点名
 * 「从本场景走得到的场景」，本场景自己的名字与写作者显式放行的名单不受限制。
 */
export function findStageNameLeaks(
  text: string,
  stageNames: readonly string[],
  allowed: ReadonlySet<string>,
): TextLeak[] {
  return stageNames
    .filter((name) => name.length > 0 && !allowed.has(name) && text.includes(name))
    .map((name) => ({ code: "stage_name" as const, token: name }));
}

/** 台词与叙述里不能出现编号：模型或玩家照抄引用会污染世界面。 */
export function assertNoSystemReference(text: string): void {
  if (containsHandle(text)) {
    throw new GameError("invalid_action", "不能出现编号引用（#编号）");
  }
}

/**
 * 世界面文本的写入守卫。
 *
 * 推理端不写 actor 记忆，也不直接产出面向 actor 的上下文；它只读控制面、只产出
 * 状态与自己的记忆。世界面文本（观察、自述、公共标签）只由引擎写入，这道守卫
 * 负责拦住漏进世界面的名字与编号。
 *
 * `actorNames` 为空时只查编号，适合“主体自己的记忆”这类名字合法的文本。
 */
export function assertWorldFaceText(
  text: string,
  actorNames: readonly string[],
  label: string,
): void {
  const leaks = findTextLeaks(text, actorNames);
  if (leaks.length > 0) {
    throw new GameError(
      "invalid_action",
      `${label} 不能包含角色名或编号引用: ${leaks.map((leak) => leak.token).join("、")}`,
    );
  }
}

/**
 * 场景侧写入守卫：在角色名 / 编号之外，再拦住「演员本来不知道的场景名」。
 *
 * 只能点名「从本场景走得到的场景」；未通的边对面叫什么，得靠发现与对话浮出来，
 * 不能由环境文本替演员宣布。
 */
export function assertStageFacingText(
  text: string,
  input: {
    actorNames: readonly string[];
    stageNames: readonly string[];
    visibleStageNames: ReadonlySet<string>;
    label: string;
  },
): void {
  const leaks = [
    ...findTextLeaks(text, input.actorNames),
    ...findStageNameLeaks(text, input.stageNames, input.visibleStageNames),
  ];
  if (leaks.length > 0) {
    throw new GameError(
      "invalid_action",
      `${input.label} 不能包含角色名、编号引用或尚未打通的场景名: ${leaks
        .map((leak) => leak.token)
        .join("、")}`,
    );
  }
}

export type ActorFacingOptions = {
  /**
   * 是否把残留的 `#12` 解析成观察者视角的引用。
   *
   * environment 需要（历史数据里可能只剩编号）；行动反馈本身就是用引用写的，
   * 必须原样保留，否则下一轮没法直接引用。
   */
  resolveHandles?: boolean;
};

/**
 * 脱敏所需的角色最小投影：id 与名字；编号解析额外需要当前签名的序号。
 *
 * `signature` 省略时只做名字替换，不解析残留编号（反馈路径本来就不解析）。
 */
export type SanitizableActor = {
  id: string;
  name: string;
  signature?: { seq: number };
};

/**
 * 把任意要写给 actor 的文本脱敏成观察者能读的版本。
 *
 * 用途有两处：environment 的读取兜底，以及写入 actor 记忆前的最后一道防线（反馈与拒绝原因）。
 * 规则与名单 / 观察一致：本场角色写成观察者当前的称呼；名字不能用时退回 `#12`，
 * 外观另起一行——对在场者来说，外观永远可观测。不在本场、无法观测的名字不编造身份。
 *
 * 名字与编号在**同一趟替换**里完成：先放名字（长的优先），再放编号，
 * 这样刚渲染出来的名字不会被随后的替换规则再处理一次。
 */
export function sanitizeActorFacingText(
  text: string,
  stageActors: readonly SanitizableActor[],
  address: AddressLookup,
  otherActorNames: readonly string[] = [],
  options: ActorFacingOptions = {},
): string {
  const entries = stageActors.map((actor) => ({ actor, resolved: address(actor.id) }));
  const byName = new Map(entries.map((entry) => [entry.actor.name, entry]));
  // 观察者视角的编号本身就是地址（名字不可用时）；它对得上本场角色，与签名序号无关。
  const byToken = new Map(
    entries
      .filter((entry) => entry.resolved.token.length > 0)
      .map((entry) => [entry.resolved.token, entry] as const),
  );
  const byHandle = new Map(
    entries.flatMap((entry) =>
      entry.actor.signature === undefined
        ? []
        : [[handleOf(entry.actor.signature.seq), entry] as const],
    ),
  );
  const appearances: string[] = [];

  // 本场角色怎么出现在句子里的：名字，或 `#12` + 独立的外观行。
  // 有名字的不重复外观行——句子里的名字已经够读；只有退回编号时才需要外观帮忙确认。
  const shown = (entry: (typeof entries)[number]): string => {
    if (isHandleRef(entry.resolved.token)) {
      const line = appearanceLine(entry.resolved);
      if (line !== null) {
        appearances.push(line);
      }
    }
    return mentionOf(entry.resolved);
  };

  // 长的名字优先，避免「父亲」把「父亲大人」切掉一半。
  const names = [...new Set([...byName.keys(), ...otherActorNames])]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const patterns = [...(names.length === 0 ? [] : [`(?:${names.join("|")})`])];
  if (options.resolveHandles !== false) {
    patterns.push(HANDLE_PATTERN.source);
  }
  if (patterns.length === 0) {
    return text;
  }

  const sanitized = text.replace(new RegExp(patterns.join("|"), "g"), (match) => {
    if (isHandleRef(match)) {
      // 残留的编号：对得上本场角色就按观察者重写，对不上说明无法观测。
      const entry = byHandle.get(match) ?? byToken.get(match);
      return entry ? shown(entry) : UNKNOWN_LABEL;
    }
    const entry = byName.get(match);
    return entry ? shown(entry) : UNKNOWN_LABEL;
  });

  const unique = [...new Set(appearances)];
  return unique.length === 0 ? sanitized : `${sanitized}\n\n${unique.join("\n")}`;
}

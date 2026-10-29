import {
  type AddressLookup,
  appearanceLine,
  HANDLE_PATTERN,
  handleOf,
  NAME_REF_PATTERN,
} from "./addressing";
import { GameError } from "./errors";

/**
 * 世界面文本的泄漏检查。
 *
 * `@名字`、`#12` 与角色本名都只属于控制面：它们可以出现在 stage / world 自己的
 * 全知记忆里，但不能进入 actor 能看到的环境、台词或结局文案。
 */

export type TextLeakCode = "reference" | "handle" | "actor_name";

export type TextLeak = {
  code: TextLeakCode;
  token: string;
};

export type TextLeakOptions = {
  /** 为 false 时只查引用与句柄，适合“名字本身合法”的 god-view 文本。 */
  actorNames?: boolean;
};

function glob(pattern: string): RegExp {
  return new RegExp(pattern, "g");
}

/**
 * 找出文本里不应出现在世界面的内容。
 *
 * 场景名、道具名是公共标签，出现在自然叙述里合法；这里只拦系统引用与角色本名。
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

  // 名字没有可靠的终止符（中文里 `@某甲说` 连在一起），因此只报告标记本身。
  if (NAME_REF_PATTERN.test(text)) {
    add("reference", "@");
  }
  for (const match of text.matchAll(glob(HANDLE_PATTERN.source))) {
    add("handle", match[0]);
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

/** 台词与叙述里不能出现系统引用：模型或玩家照抄引用会污染世界面。 */
export function assertNoSystemReference(text: string): void {
  if (NAME_REF_PATTERN.test(text) || HANDLE_PATTERN.test(text)) {
    throw new GameError("invalid_action", "不能出现系统引用标记");
  }
}

/**
 * 世界面文本的写入守卫。
 *
 * 推理端不写 actor 记忆，也不直接产出面向 actor 的上下文；它只读控制面、只产出
 * 状态与自己的记忆。世界面文本（观察、自述、公共标签）只由引擎写入，这道守卫
 * 负责拦住漏进世界面的名字与引用。
 *
 * `actorNames` 为空时只查引用，适合“主体自己的记忆”这类名字合法的文本。
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
      `${label} 不能包含角色名或系统引用（@ / #编号）: ${leaks.map((leak) => leak.token).join("、")}`,
    );
  }
}

export type ActorFacingOptions = {
  /**
   * 是否把残留的 `#12` 解析成观察者视角的引用。
   *
   * environment 需要（历史数据里可能只剩句柄）；行动反馈本身就是用引用写的，
   * 必须原样保留，否则下一轮没法直接引用。
   */
  resolveHandles?: boolean;
};

/**
 * 脱敏所需的角色最小投影：id 与名字；句柄解析额外需要当前形象的序号。
 *
 * `presentation` 省略时只做名字替换，不解析残留句柄（反馈路径本来就不解析）。
 */
export type SanitizableActor = {
  id: string;
  name: string;
  presentation?: { seq: number };
};

/**
 * 把任意要写给 actor 的文本脱敏成观察者能读的版本。
 *
 * 用途有两处：environment 的读取兜底，以及写入 actor 记忆前的最后一道防线（反馈与拒绝原因）。
 * 规则与名单 / 观察一致：本场角色写成 `@名字`；不知道名字时保留 `#12`，外观另起一行
 * ——对在场者来说，外观永远可观测。不在本场、无法观测的名字不编造身份。
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
  const byToken = new Map(
    entries
      .filter((entry) => entry.resolved.token.length > 0)
      .map((entry) => [entry.resolved.token, entry]),
  );
  // 已知名字的角色 token 是 @名字，但旧文本里可能还留着它的 #序号。
  const byHandle = new Map(
    entries.flatMap((entry) =>
      entry.actor.presentation === undefined
        ? []
        : [[handleOf(entry.actor.presentation.seq), entry] as const],
    ),
  );
  const appearances: string[] = [];

  // 本场角色怎么出现在句子里的：`@名字`，或 `#12` + 独立的外观行。
  const shown = (entry: (typeof entries)[number]): string => {
    if (entry.resolved.knownName !== null) {
      return entry.resolved.mention;
    }
    const line = appearanceLine(entry.resolved);
    if (line !== null) {
      appearances.push(line);
    }
    return entry.resolved.token.length > 0 ? entry.resolved.token : "某个不在场者";
  };

  let sanitized = text;
  for (const [name, entry] of byName) {
    // 只处理裸名字：已经写成 `@名字` 的引用不再重复替换，也不收集外观。
    const bareName = new RegExp(`(?<!@)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    if (!bareName.test(sanitized)) {
      continue;
    }
    sanitized = sanitized.replace(bareName, shown(entry));
  }
  if (options.resolveHandles !== false) {
    // 残留的 `#12`：对得上本场角色就按观察者重写，对不上说明无法观测。
    sanitized = sanitized.replace(glob(HANDLE_PATTERN.source), (handle) => {
      const entry = byHandle.get(handle) ?? byToken.get(handle);
      return entry ? shown(entry) : "某个不在场者";
    });
  }
  for (const name of otherActorNames) {
    sanitized = sanitized.split(name).join("某个不在场者");
  }

  const unique = [...new Set(appearances)];
  return unique.length === 0 ? sanitized : `${sanitized}\n\n${unique.join("\n")}`;
}

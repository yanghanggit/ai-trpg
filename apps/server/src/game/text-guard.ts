import { type AddressLookup, appearanceLine, HANDLE_PATTERN } from "./addressing";
import { ENTITY_PREFIX, plainEntityName } from "./entity-name";

/**
 * 世界面文本的泄漏检查。
 *
 * 规范名、`@N` 指代与角色本名都只属于控制面：它们可以出现在 stage / world 自己的
 * 全知记忆里，但不能进入 actor 能看到的环境、台词或结局文案。
 */

const PREFIXES = Object.values(ENTITY_PREFIX).sort((a, b) => b.length - a.length);

/** 只匹配 `类别.` 前缀；名称部分由 actorNames 精确匹配，避免吞掉后面的中文。 */
export const CANONICAL_ENTITY_PREFIX_PATTERN = new RegExp(`(?:${PREFIXES.join("|")})\\.`, "g");

export type TextLeakCode = "handle" | "canonical_name" | "actor_name";

export type TextLeak = {
  code: TextLeakCode;
  token: string;
};

export type TextLeakOptions = {
  /** 为 false 时只查句柄与规范名，适合“名字本身合法”的 god-view 文本。 */
  actorNames?: boolean;
};

function glob(pattern: string): RegExp {
  return new RegExp(pattern, "g");
}

/**
 * 找出文本里不应出现在世界面的内容。
 *
 * `actorNames` 同时检查规范名与去掉前缀的本名；结果按 `code:token` 去重。
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

  for (const match of text.matchAll(glob(HANDLE_PATTERN.source))) {
    add("handle", match[0]);
  }
  for (const match of text.matchAll(glob(CANONICAL_ENTITY_PREFIX_PATTERN.source))) {
    add("canonical_name", match[0]);
  }
  if (options.actorNames !== false) {
    for (const name of actorNames) {
      for (const candidate of new Set([name, plainEntityName(name)])) {
        if (candidate.length > 0 && text.includes(candidate)) {
          add("actor_name", candidate);
        }
      }
    }
  }
  return [...found.values()];
}

export function hasCanonicalEntityName(text: string): boolean {
  return new RegExp(CANONICAL_ENTITY_PREFIX_PATTERN.source).test(text);
}

/**
 * 把 environment 脱敏成某个观察者能读的文本（读取时的最后一道防线）。
 *
 * 正常内容不会在 environment 里写角色：写入校验已经拒绝名字、`@N` 与类别前缀。
 * 这里只处理历史数据与内容漂移，规则与名单 / 观察一致：本场角色用观察者眼里的称呼；
 * 不知道名字时句子用指代 `@N`，外观另起一行——对在场者来说，外观永远可观测。
 * 不在本场、无法观测的名字不编造身份，替换成泛称。
 */
export function sanitizeStageEnvironment(
  environment: string,
  stageActors: readonly { id: string; name: string }[],
  address: AddressLookup,
  otherActorNames: readonly string[] = [],
): string {
  const entries = stageActors.map((actor) => ({ actor, resolved: address(actor.id) }));
  const byName = new Map(entries.map((entry) => [entry.actor.name, entry]));
  const byToken = new Map(
    entries
      .filter((entry) => entry.resolved.token.length > 0)
      .map((entry) => [entry.resolved.token, entry]),
  );
  const appearances: string[] = [];

  // 本场角色怎么出现在句子里的：名字，或「指代 + 独立的外观行」。
  const shown = (entry: (typeof entries)[number]): string => {
    if (entry.resolved.knownName !== null) {
      return entry.resolved.knownName;
    }
    const line = appearanceLine(entry.resolved);
    if (line !== null) {
      appearances.push(line);
    }
    return entry.resolved.token.length > 0 ? entry.resolved.token : "某个不在场者";
  };

  let text = environment;
  for (const [name, entry] of byName) {
    text = text.split(name).join(shown(entry));
  }
  // 残留的指代：对得上本场角色就按观察者重写，对不上说明无法观测。
  text = text.replace(glob(HANDLE_PATTERN.source), (handle) => {
    const entry = byToken.get(handle);
    return entry ? shown(entry) : "某个不在场者";
  });
  for (const name of otherActorNames) {
    text = text.split(name).join("某个不在场者");
  }
  text = text.replace(glob(CANONICAL_ENTITY_PREFIX_PATTERN.source), "");

  const unique = [...new Set(appearances)];
  return unique.length === 0 ? text : `${text}\n\n${unique.join("\n")}`;
}

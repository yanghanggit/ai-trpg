import { type AddressLookup, HANDLE_PATTERN, mentionOf } from "./addressing";
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
 * 把 environment 渲染成某个观察者能看到的文本。
 *
 * 写入时已经会拒绝名字与指代；这里是读取时的最后一道防线，处理历史数据与内容里的
 * 规范名：本场角色用它在该观察者眼里的称呼，世界内其他角色替换成模糊身影，剩余
 * 类型前缀直接去掉。
 */
export function renderEnvironmentForActor(
  environment: string,
  stageActors: readonly { id: string; name: string }[],
  address: AddressLookup,
  otherActorNames: readonly string[] = [],
): string {
  let text = environment.replace(glob(HANDLE_PATTERN.source), "一个看不清的身影");
  for (const actor of stageActors) {
    text = text.split(actor.name).join(mentionOf(address(actor.id)));
  }
  for (const name of otherActorNames) {
    text = text.split(name).join("一个看不清的身影");
  }
  text = text.replace(glob(CANONICAL_ENTITY_PREFIX_PATTERN.source), "");
  return text;
}

import { describe, expect, it } from "vitest";
import {
  ENTITY_PREFIX,
  entityKindOf,
  entityName,
  ITEM_PREFIX,
  isCanonicalName,
  plainEntityName,
  splitEntityName,
} from "../src/game/entity-name";

describe("entity names", () => {
  it("builds canonical names from the system vocabulary", () => {
    expect(entityName("actor", "某甲")).toBe("角色.某甲");
    expect(entityName("stage", "某地")).toBe("场景.某地");
    expect(entityName("world", "某故事")).toBe("世界.某故事");
    expect(entityName("weapon", "某物")).toBe("武器.某物");
  });

  it("splits only the first separator", () => {
    expect(splitEntityName("贵重物.某.物")).toEqual({
      kind: "valuable",
      prefix: "贵重物",
      plain: "某.物",
    });
    expect(plainEntityName("角色.某甲")).toBe("某甲");
    // 没有前缀的名字原样返回：测试夹具与过渡内容允许这种写法。
    expect(plainEntityName("某甲")).toBe("某甲");
  });

  it("keeps unknown prefixes out of the known vocabulary", () => {
    expect(entityKindOf("道具.某物")).toBeNull();
    expect(splitEntityName("道具.某物")).toEqual({
      kind: null,
      prefix: "道具",
      plain: "某物",
    });
    expect(isCanonicalName("道具.某物", "weapon")).toBe(false);
  });

  it("checks a name against its expected category", () => {
    expect(isCanonicalName("角色.某甲", "actor")).toBe(true);
    expect(isCanonicalName("场景.某甲", "actor")).toBe(false);
    expect(isCanonicalName("某甲", "actor")).toBe(false);
  });

  it("maps every item kind to one prefix", () => {
    expect(new Set(Object.values(ITEM_PREFIX)).size).toBe(Object.keys(ITEM_PREFIX).length);
    for (const [kind, prefix] of Object.entries(ITEM_PREFIX)) {
      expect(ENTITY_PREFIX[kind as keyof typeof ENTITY_PREFIX]).toBe(prefix);
      expect(isCanonicalName(`${prefix}.某物`, kind as keyof typeof ENTITY_PREFIX)).toBe(true);
    }
  });
});

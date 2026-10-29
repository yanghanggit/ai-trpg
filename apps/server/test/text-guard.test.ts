import { describe, expect, it } from "vitest";
import {
  findTextLeaks,
  hasCanonicalEntityName,
  sanitizeStageEnvironment,
} from "../src/game/text-guard";

describe("world text guard", () => {
  it("finds handles, canonical names and actor names", () => {
    const leaks = findTextLeaks("角色.奥德里克与 @12 站在场景.墓园，煤渣趴在武器.铁锹边。", [
      "角色.奥德里克",
      "角色.煤渣",
    ]);
    expect(leaks).toEqual(
      expect.arrayContaining([
        { code: "handle", token: "@12" },
        { code: "canonical_name", token: "角色." },
        { code: "canonical_name", token: "场景." },
        { code: "canonical_name", token: "武器." },
        { code: "actor_name", token: "角色.奥德里克" },
        { code: "actor_name", token: "奥德里克" },
        { code: "actor_name", token: "煤渣" },
      ]),
    );
  });

  it("can ignore actor names for god-view text", () => {
    expect(findTextLeaks("奥德里克站在墓园。", ["角色.奥德里克"], { actorNames: false })).toEqual(
      [],
    );
    expect(hasCanonicalEntityName("奥德里克站在墓园。")).toBe(false);
    expect(hasCanonicalEntityName("角色.奥德里克站在墓园。")).toBe(true);
  });

  const ADDRESS = (known: boolean) => (id: string) =>
    id === "a" && known
      ? {
          token: "@9",
          label: "煤渣（灰毛犬）",
          mention: "煤渣",
          appearance: "灰毛犬",
          knownName: "煤渣",
        }
      : {
          token: "@9",
          label: "外观：灰毛犬",
          mention: "@9",
          appearance: "灰毛犬",
          knownName: null,
        };

  it("renders in-stage actors with their known name or handle", () => {
    const actor = { id: "a", name: "角色.煤渣" };
    const rendered = sanitizeStageEnvironment(
      "角色.煤渣守在@12 身旁，场景.地窖的台阶湿滑。",
      [actor],
      ADDRESS(true),
    );
    // 名字照称呼；本场外的旧指代无法观测，换成泛称。
    expect(rendered).toBe("煤渣守在某个不在场者 身旁，地窖的台阶湿滑。");
  });

  it("keeps appearance for an in-stage actor whose name is unknown", () => {
    const stranger = { id: "a", name: "角色.无名者" };
    const rendered = sanitizeStageEnvironment("角色.无名者站在坡底。", [stranger], ADDRESS(false));
    // 在场者一定看得见：句子用指代，外观单独成行，不冒充称呼也不退成影子。
    expect(rendered).toBe("@9站在坡底。\n\n@9 外观：灰毛犬");
  });

  it("resolves leftover handles of in-stage actors the same way", () => {
    const stranger = { id: "a", name: "角色.无名者" };
    const rendered = sanitizeStageEnvironment("坡底站着 @9。", [stranger], ADDRESS(false));
    expect(rendered).toBe("坡底站着 @9。\n\n@9 外观：灰毛犬");
  });
});

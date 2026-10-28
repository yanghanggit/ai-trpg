import { describe, expect, it } from "vitest";
import {
  findTextLeaks,
  hasCanonicalEntityName,
  renderEnvironmentForActor,
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

  it("renders canonical names and handles into an observer-relative environment", () => {
    const actor = { id: "a", name: "角色.煤渣" };
    const rendered = renderEnvironmentForActor(
      "角色.煤渣守在 @12 身旁，场景.地窖的台阶湿滑。",
      [actor],
      (id) => ({
        token: "@9",
        label: "煤渣",
        mention: id === "a" ? "煤渣" : "一个看不清的身影",
        knownName: id === "a" ? "煤渣" : null,
      }),
    );
    expect(rendered).toBe("煤渣守在 一个看不清的身影 身旁，地窖的台阶湿滑。");
  });
});

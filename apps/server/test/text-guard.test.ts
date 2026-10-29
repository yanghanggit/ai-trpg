import { describe, expect, it } from "vitest";
import { findTextLeaks, sanitizeActorFacingText } from "../src/game/text-guard";

describe("world text guard", () => {
  it("finds references, handles and actor names", () => {
    const leaks = findTextLeaks("奥德里克对@煤渣说，@奥德里克站在 #12 身旁。", [
      "奥德里克",
      "煤渣",
    ]);
    expect(leaks).toEqual(
      expect.arrayContaining([
        { code: "reference", token: "@" },
        { code: "handle", token: "#12" },
        { code: "actor_name", token: "奥德里克" },
        { code: "actor_name", token: "煤渣" },
      ]),
    );
  });

  it("ignores plain names for god-view text but still blocks references", () => {
    expect(findTextLeaks("奥德里克站在墓园。", ["奥德里克"], { actorNames: false })).toEqual([]);
    expect(findTextLeaks("你对@奥德里克说。", ["奥德里克"], { actorNames: false })).toEqual([
      { code: "reference", token: "@" },
    ]);
  });

  const ADDRESS = (known: boolean) => (id: string) =>
    id === "a" && known
      ? {
          token: "@煤渣",
          label: "煤渣（灰毛犬）",
          mention: "@煤渣",
          appearance: "灰毛犬",
          knownName: "煤渣",
          isSelf: false,
        }
      : {
          token: "#9",
          label: "外观：灰毛犬",
          mention: "#9",
          appearance: "灰毛犬",
          knownName: null,
          isSelf: false,
        };

  it("renders an in-stage actor as a name reference", () => {
    const actor = { id: "a", name: "煤渣" };
    const rendered = sanitizeActorFacingText(
      "煤渣守在#12 身旁，地窖的台阶湿滑。",
      [actor],
      ADDRESS(true),
    );
    // 名字换成引用；本场外的旧编号无法观测，换成泛称。
    expect(rendered).toBe("@煤渣守在某个不在场者 身旁，地窖的台阶湿滑。");
  });

  it("keeps appearance for an in-stage actor whose name is unknown", () => {
    const stranger = { id: "a", name: "无名者" };
    const rendered = sanitizeActorFacingText("无名者站在坡底。", [stranger], ADDRESS(false));
    // 在场者一定看得见：句子用编号，外观单独成行。
    expect(rendered).toBe("#9站在坡底。\n\n#9 外观：灰毛犬");
  });

  it("keeps handles when sanitizing action feedback", () => {
    const stranger = { id: "a", name: "无名者" };
    const rendered = sanitizeActorFacingText(
      "你对#9挥击（使用铁锹）。",
      [stranger],
      ADDRESS(false),
      [],
      { resolveHandles: false },
    );
    // 反馈是下一轮寻址的依据：编号必须原样保留。
    expect(rendered).toBe("你对#9挥击（使用铁锹）。");
  });

  it("resolves leftover handles of in-stage actors the same way", () => {
    const stranger = { id: "a", name: "无名者" };
    const rendered = sanitizeActorFacingText("坡底站着 #9。", [stranger], ADDRESS(false));
    expect(rendered).toBe("坡底站着 #9。\n\n#9 外观：灰毛犬");
  });
});

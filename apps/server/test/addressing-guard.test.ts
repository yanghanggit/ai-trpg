import { describe, expect, it } from "vitest";
import {
  assertWorldFaceText,
  findTextLeaks,
  sanitizeActorFacingText,
} from "../src/game/addressing";

describe("world text guard", () => {
  it("finds handles and actor names", () => {
    const leaks = findTextLeaks("煤渣对奥德里克说，他站在 #12 身旁。", ["奥德里克", "煤渣"]);
    expect(leaks).toEqual(
      expect.arrayContaining([
        { code: "handle", token: "#12" },
        { code: "actor_name", token: "奥德里克" },
        { code: "actor_name", token: "煤渣" },
      ]),
    );
    expect(leaks.some((leak) => leak.code === "handle")).toBe(true);
  });

  it("ignores plain names for god-view text but still blocks handles", () => {
    expect(findTextLeaks("奥德里克站在墓园。", ["奥德里克"], { actorNames: false })).toEqual([]);
    expect(findTextLeaks("你身旁站着 #3。", ["奥德里克"], { actorNames: false })).toEqual([
      { code: "handle", token: "#3" },
    ]);
  });

  it("assertWorldFaceText 拦编号与角色名，空名字列表只拦编号", () => {
    expect(() => assertWorldFaceText("你身旁站着 #12。", [], "外观")).toThrow(/外观 不能包含/);
    expect(() => assertWorldFaceText("#12 站在门口。", [], "材料名")).toThrow(/编号引用/);
    expect(() => assertWorldFaceText("守烬人的骨片。", ["守烬人"], "材料描述")).toThrow(/角色名/);
    // 主体自己的记忆里名字是合法的，只拦编号。
    expect(() => assertWorldFaceText("你记得自己叫煤渣。", [], "世界面文本")).not.toThrow();
  });

  const ADDRESS = (known: boolean) => (id: string) =>
    id === "a" && known
      ? { token: "煤渣", appearance: "灰毛犬", isSelf: false }
      : { token: "#9", appearance: "灰毛犬", isSelf: false };

  it("renders an in-stage actor by the observer's name", () => {
    const actor = { id: "a", name: "煤渣" };
    const rendered = sanitizeActorFacingText(
      "煤渣守在#12 身旁，地窖的台阶湿滑。",
      [actor],
      ADDRESS(true),
    );
    // 名字换成观察者称呼；本场外的旧编号无法观测，换成泛称。
    expect(rendered).toBe("煤渣守在某个不在场者 身旁，地窖的台阶湿滑。");
  });

  it("resolves a known actor's leftover handle to its name", () => {
    const actor = { id: "a", name: "煤渣", signature: { seq: 9 } };
    const rendered = sanitizeActorFacingText("煤渣守在#9 身旁。", [actor], ADDRESS(true));
    // 名字与旧编号都换成观察者视角的引用。
    expect(rendered).toBe("煤渣守在煤渣 身旁。");
  });

  it("keeps appearance for an in-stage actor whose name is unknown", () => {
    const stranger = { id: "a", name: "无名者" };
    const rendered = sanitizeActorFacingText("无名者站在坡底。", [stranger], ADDRESS(false));
    // 在场者一定看得见：句子用编号，外观单独成行。
    expect(rendered).toBe("#9站在坡底。\n\n#9 外观：灰毛犬");
  });

  it("keeps the observer's name as a label when it cannot be an address", () => {
    const stranger = { id: "a", name: "无名者" };
    const ambiguous = () => ({
      token: "#9",
      appearance: "灰毛犬",
      isSelf: false,
      knownName: "父亲",
    });
    const rendered = sanitizeActorFacingText("无名者站在坡底。", [stranger], ambiguous);
    expect(rendered).toBe("#9站在坡底。\n\n#9 外观：灰毛犬｜你的称呼：父亲");
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

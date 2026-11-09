import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "../src/game/actions";
import { ACTOR_ACTION_TOOLKITS, createPlanSession } from "../src/game/actor-turn";
import { MAX_ACTIONS_PER_TURN } from "../src/game/limits";

const wait = () => ({ kind: "wait" }) as const;

describe("turn plan session", () => {
  it("没提交也保留已暂存的行动：轮次用尽时计划不丢", () => {
    const session = createPlanSession();
    session.addAction(wait());

    // 模型忘了调 submit_plan：计划仍然是刚才那一条，而不是空计划。
    expect(session.submitted).toBe(false);
    expect(session.plan).toEqual({ actions: [{ kind: "wait" }] });
  });

  it("从没写过任何东西时没有计划", () => {
    expect(createPlanSession().plan).toBeNull();
  });

  it("提交后计划就是提交的那一份，再写要拒绝", () => {
    const session = createPlanSession();
    session.addAction(wait());
    session.submit();

    expect(session.submitted).toBe(true);
    expect(() => session.addAction(wait())).toThrow("计划已提交");
    expect(() => session.submit()).toThrow("计划已提交");
  });

  it("空计划与超过条数上限都不成立", () => {
    expect(() => createPlanSession().submit()).toThrow("计划中没有行动");

    const session = createPlanSession();
    for (let index = 0; index < MAX_ACTIONS_PER_TURN; index += 1) {
      session.addAction(wait());
    }
    expect(() => session.addAction(wait())).toThrow(`本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动`);
  });

  it("同一编号重复记称呼是覆盖，不是新增", () => {
    const session = createPlanSession();
    expect(session.addIdentity({ handle: "#3", name: "卫兵" })).toBe("added");
    expect(session.addIdentity({ handle: "#3", name: "老卫兵" })).toBe("updated");
    expect(session.plan).toEqual({ actions: [], identities: [{ handle: "#3", name: "老卫兵" }] });
  });

  it("同一条路线问题只记一次，失败路线同理", () => {
    const session = createPlanSession();
    const route = { fromStageId: "a", toStageId: "b" };
    expect(session.noteRoute(route)).toBe(true);
    expect(session.noteRoute(route)).toBe(false);

    const failure = { toStageRef: "不存在的地方", reason: "unknown_stage" } as const;
    expect(session.noteRouteFailure(failure)).toBe(true);
    expect(session.noteRouteFailure(failure)).toBe(false);
    expect(session.plan?.routes).toEqual([route]);
    expect(session.plan?.routeFailures).toEqual([failure]);
  });

  it("计划是快照：取出来之后再写不会改到已取出的那份", () => {
    const session = createPlanSession();
    session.addAction({ kind: "say", mind: "", targetActorHandle: "#2", message: "你好" });
    const first = session.plan;
    session.addIdentity({ handle: "#2", name: "提灯修士" });

    expect(first).toEqual({
      actions: [{ kind: "say", mind: "", targetActorHandle: "#2", message: "你好" }],
    });
    expect(session.plan?.identities).toEqual([{ handle: "#2", name: "提灯修士" }]);
  });

  it("每个动作都有工具与解析器，一个不漏", () => {
    // 编译期由 `Record<ActionKind, …>` 保证；这里再确认运行时表与 kind 清单同长。
    expect(Object.keys(ACTOR_ACTION_TOOLKITS).sort()).toEqual([...ACTION_KINDS].sort());
  });
});

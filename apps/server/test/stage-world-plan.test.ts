import { describe, expect, it } from "vitest";
import {
  MAX_STAGE_ANCHOR_WRITES_PER_TURN,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MAX_WORLD_ACTIONS_PER_TURN,
} from "../src/game/constants";
import { createStagePlanSession } from "../src/game/stage-turn";
import { createWorldPlanSession } from "../src/game/world-turn";

describe("stage plan session", () => {
  it("environment 是快照：同一轮写两次只留后一次", () => {
    const session = createStagePlanSession();
    session.setEnvironment("地上有灰。");
    session.setEnvironment("地上有灰，还有一串新脚印。");
    expect(session.plan).toEqual({
      actions: [{ kind: "submit_environment", environment: "地上有灰，还有一串新脚印。" }],
    });
  });

  it("写入即提交：没调 submit_stage_plan 也不会丢", () => {
    const session = createStagePlanSession();
    session.setEnvironment("门开着。");
    expect(session.plan?.actions).toHaveLength(1);
  });

  it("一次都没写时没有计划；显式提交空计划是合法的 no-op", () => {
    const empty = createStagePlanSession();
    expect(empty.plan).toBeNull();
    empty.submit();
    expect(empty.plan).toEqual({ actions: [] });
  });

  it("各类动作的条数上限在写入时就拒绝", () => {
    const notifications = createStagePlanSession();
    for (let index = 0; index < MAX_STAGE_NOTIFICATIONS_PER_TURN; index += 1) {
      notifications.addNotification(`第 ${index} 条`);
    }
    expect(() => notifications.addNotification("再来一条")).toThrow(
      `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
    );

    const passages = createStagePlanSession();
    passages.addPassage("山道");
    expect(() => passages.addPassage("河谷")).toThrow("本轮最多打开一条通道");

    const anchors = createStagePlanSession();
    for (let index = 0; index < MAX_STAGE_ANCHOR_WRITES_PER_TURN; index += 1) {
      anchors.addAnchor({ kind: "add_anchor", label: `锚点 ${index}` });
    }
    expect(() => anchors.addAnchor({ kind: "add_anchor", label: "再来一个" })).toThrow(
      `本轮最多调整 ${MAX_STAGE_ANCHOR_WRITES_PER_TURN} 个锚点`,
    );
  });
});

describe("world plan session", () => {
  it("条数上限在写入时拒绝，提交后不能再写", () => {
    const session = createWorldPlanSession();
    for (let index = 0; index < MAX_WORLD_ACTIONS_PER_TURN; index += 1) {
      session.add({ kind: "notify_stage", stageName: "山道", content: `第 ${index} 条` });
    }
    expect(() =>
      session.add({ kind: "notify_stage", stageName: "山道", content: "再来一条" }),
    ).toThrow(`本轮最多 ${MAX_WORLD_ACTIONS_PER_TURN} 个世界动作`);

    const submitted = createWorldPlanSession();
    submitted.submit();
    expect(() =>
      submitted.add({ kind: "notify_stage", stageName: "山道", content: "迟到的通知" }),
    ).toThrow("计划已提交");
  });

  it("没写也没提交就没有计划，空提交才是合法 no-op", () => {
    expect(createWorldPlanSession().plan).toBeNull();
    const session = createWorldPlanSession();
    session.submit();
    expect(session.plan).toEqual({ actions: [] });
  });
});

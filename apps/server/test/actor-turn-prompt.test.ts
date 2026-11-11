import { describe, expect, it } from "vitest";
import type { ActorTurnContext } from "../src/game/agents/actor-turn";
import {
  buildActorLookTool,
  buildKnowledgeTool,
  buildRecallRouteTool,
  buildRecognizeIdentityTool,
  buildSelfInfoTool,
  buildVisitedStagesTool,
} from "../src/game/agents/actor-turn";
import { renderTask } from "../src/game/agents/actor-turn/prompt";
import { renderHints } from "../src/game/agents/actor-turn/prompt-hints";
import { ACTOR_READ_ONLY_TOOL_NAMES } from "../src/game/agents/actor-turn/tools";
import type { ActionKind } from "../src/game/kernel/types";

/**
 * 任务提示词的骨架与提示：环境段要 state，这里只测不依赖 state 的两块
 * （环境段的渲染由回合用例覆盖）。
 *
 * 这两块最容易悄悄坏：提示按能力出现、空提示必须消失，三步流程与轮数预算写在模板里。
 */
function stubContext(input: { allowed?: ActionKind[]; targets?: string[] }): ActorTurnContext {
  return {
    allowed: input.allowed ?? [],
    targets: input.targets ?? [],
  } as unknown as ActorTurnContext;
}

describe("actor 任务提示词", () => {
  it("只读工具名与工具定义同源", () => {
    const declared = [
      buildActorLookTool(),
      buildSelfInfoTool(),
      buildVisitedStagesTool(),
      buildRecallRouteTool(),
      buildKnowledgeTool(),
      buildRecognizeIdentityTool(["#1"]),
    ].map((tool) => tool.function.name);

    expect(ACTOR_READ_ONLY_TOOL_NAMES).toEqual(declared);
    // 「读」那一步必须把每个只读工具都点名，否则模型不知道能问什么。
    const task = renderTask(stubContext({}), 3);
    for (const name of declared) {
      expect(task).toContain(name);
    }
  });

  it("没有可用动作时只剩通用提示", () => {
    const hints = renderHints(stubContext({}));

    // 能力相关的细则全部消失。
    expect(hints).not.toContain("传音不会自动暴露你是谁");
    expect(hints).not.toContain("steal");
    expect(hints).not.toContain("先 inspect 看清");
    expect(hints).not.toContain("武器用");
    // 通用提示仍在：怎么看自己、公共事实要检索、行动对象怎么写、只读工具能问什么。
    expect(hints).toContain("要看自己的完整信息用 get_self");
    expect(hints).toContain("必须先调用 query 检索");
    expect(hints).toContain("行动对象写你对它的称呼");
    expect(hints).toContain("look_stage 只能看本场景");
  });

  it("按能力出现的提示：只说本回合真能用的", () => {
    const hints = renderHints(
      stubContext({ allowed: ["strike", "cleave", "inspect", "steal", "loot", "call"] }),
    );
    // 有武器就不要再劝 brawl / 说无法攻击。
    expect(hints).not.toContain("brawl");
    expect(hints).not.toContain("无法发起攻击");
    // 有 steal 与 loot 时按对象分工的那一句；有 steal 时的敏捷细则。
    expect(hints).toContain("活人用 steal");
    expect(hints).toContain("查看与窃取比敏捷");
    expect(hints).toContain("传音不会自动暴露你是谁");
  });

  it("没有武器、也没有 brawl 时明确说不能攻击", () => {
    expect(renderHints(stubContext({ allowed: ["wait"] }))).toContain("无法发起攻击");
    expect(renderHints(stubContext({ allowed: ["brawl"] }))).toContain("近战只能用 brawl");
  });

  it("名单里还有编号时才提醒起名", () => {
    expect(renderHints(stubContext({ targets: ["守墓人"] }))).not.toContain("recognize_identity");
    expect(renderHints(stubContext({ targets: ["守墓人", "#7"] }))).toContain("recognize_identity");
  });

  it("三步流程带上轮数预算与本轮可用的动作", () => {
    const task = renderTask(stubContext({ allowed: ["say", "move"] }), 5);

    expect(task).toContain("# 本轮任务");
    expect(task).toContain("本轮只有一件事要做：决定并提交 1 个行动");
    expect(task).toContain("1. 读：");
    expect(task).toContain("本回合的推理预算是 5 轮");
    expect(task).toContain("2. 写：say（");
    expect(task).toContain("move（");
    expect(task).toContain("3. 提交：submit_plan");
  });
});

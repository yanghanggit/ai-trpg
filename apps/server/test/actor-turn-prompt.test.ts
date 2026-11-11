import { describe, expect, it } from "vitest";
import { buildCallTool } from "../src/game/actions/call";
import { buildLootTool } from "../src/game/actions/loot";
import { buildStealTool } from "../src/game/actions/steal";
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
 * 任务提示词的骨架与提示：环境段要 state，这里只测不依赖 state 的部分。
 *
 * 守两件事：一是提示只放跨工具的先后顺序与取舍，二是单工具的契约留在工具描述里
 * （下沉过的那几条规则在这里反向确认，免得被顺手删掉）。
 */
function stubContext(input: { allowed?: ActionKind[]; targets?: string[] }): ActorTurnContext {
  return {
    allowed: input.allowed ?? [],
    targets: input.targets ?? [],
  } as unknown as ActorTurnContext;
}

function descriptionOf(tool: { function: { description: string } }): string {
  return tool.function.description;
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

  it("提示不复述单个工具的契约", () => {
    const hints = renderHints(
      stubContext({ allowed: ["strike", "cleave", "inspect", "steal", "loot", "call", "use"] }),
    );

    // 这些规则已经住在工具描述里：传音身份、偷与搜刮的分工、只读工具各自看什么、看全自己。
    expect(hints).not.toContain("传音");
    expect(hints).not.toContain("活人用 steal");
    expect(hints).not.toContain("look_stage");
    expect(hints).not.toContain("get_visited_stages");
    expect(hints).not.toContain("recall_route");
    expect(hints).not.toContain("要看自己的完整信息");
  });

  it("提示只放跨工具的先后顺序与取舍", () => {
    const hints = renderHints(
      stubContext({ allowed: ["strike", "cleave", "inspect", "steal", "loot", "use"] }),
    );

    // 取物前的顺序、查看与窃取的判定、已穿戴物品的替代动作。
    expect(hints).toContain("先 inspect 看清");
    expect(hints).toContain("查看与窃取比敏捷");
    expect(hints).toContain("已穿戴的物品不能用 use");
    // 有武器时不再劝 brawl，也不说无法攻击。
    expect(hints).not.toContain("brawl");
    expect(hints).not.toContain("无法发起攻击");
  });

  it("没有出手方式时说清不能攻击", () => {
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

describe("工具描述承接的单工具契约", () => {
  it("call 说清传音与身份", () => {
    expect(descriptionOf(buildCallTool())).toContain("自称");
  });

  it("steal / loot 互相指路并说清边界", () => {
    expect(descriptionOf(buildStealTool([]))).toContain("拿不走目标穿戴中的东西");
    expect(descriptionOf(buildStealTool([]))).toContain("尸体不能偷");
    expect(descriptionOf(buildLootTool([]))).toContain("只能对尸体");
    expect(descriptionOf(buildLootTool([]))).toContain("活人用 steal");
  });

  it("get_self / look_stage 说清范围与代价", () => {
    expect(descriptionOf(buildSelfInfoTool())).toContain("全部物品");
    expect(descriptionOf(buildSelfInfoTool())).toContain("不占行动名额");
    expect(descriptionOf(buildActorLookTool())).toContain("看不了别的场景");
  });
});

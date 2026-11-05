import type { z } from "zod";
import { NAME_MARKER_PATTERN } from "./reference";
import { findTextLeaks } from "./text-guard";
import { WORLD_FUNCTION_TYPES } from "./types";
import type { World } from "./world-definition";

/**
 * 跨实体的内容不变量：名字、文本泄漏、锚点与能力清单。
 *
 * 这些规则都要看整张世界图，所以不塞回 `world-schema.ts` 的形状里；
 * 由 `parse-world-content.ts` 在解析时统一执行。
 */
export function checkWorldInvariants(world: World, ctx: z.RefinementCtx): void {
  // 职能宪法由内容层定档，但框架要确认它真的带上了这一局的设定与规则。
  checkFunctionPrompts(world, ctx);
  // 名字就是名字：角色与场景在 world 内全局唯一，且不能带系统标记字符。
  checkEntityNamesUnique(world, ctx);
  const actorNames = world.actors.map((actor) => actor.name);
  world.stages.forEach((stage, index) => {
    checkEntityName(stage.name, ["stages", index, "name"], ctx);
    checkItemNamesUnique(stage.items ?? [], ["stages", index, "items"], ctx);
    const leaks = findTextLeaks(stage.environment, actorNames);
    if (leaks.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `environment 不能包含角色名或编号引用: ${leaks
          .map((leak) => leak.token)
          .join("、")}`,
        path: ["stages", index, "environment"],
      });
    }
    if (!stage.actions.includes("submit_environment")) {
      ctx.addIssue({
        code: "custom",
        message: "每个场景都必须声明 submit_environment",
        path: ["stages", index, "actions"],
      });
    }
    const anchorLabels = new Set<string>();
    stage.anchors?.forEach((anchor, anchorIndex) => {
      if (anchorLabels.has(anchor.label)) {
        ctx.addIssue({
          code: "custom",
          message: `锚点标签重复: ${anchor.label}`,
          path: ["stages", index, "anchors", anchorIndex, "label"],
        });
      }
      anchorLabels.add(anchor.label);
      const anchorLeaks = findTextLeaks(
        [anchor.label, anchor.description ?? ""].join("\n"),
        actorNames,
      );
      if (anchorLeaks.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `锚点不能包含角色名或编号引用: ${anchorLeaks
            .map((leak) => leak.token)
            .join("、")}`,
          path: ["stages", index, "anchors", anchorIndex],
        });
      }
    });
  });
  world.actors.forEach((actor, index) => {
    checkEntityName(actor.name, ["actors", index, "name"], ctx);
    checkItemNamesUnique(actor.items, ["actors", index, "items"], ctx);
  });
}

/** 名字里不能出现系统标记：`#` 是地址，`@` 是旧版地址标记，点号是旧前缀分隔符。 */
function checkEntityName(raw: string, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (NAME_MARKER_PATTERN.test(raw) || /[\s.]/.test(raw)) {
    ctx.addIssue({
      code: "custom",
      message: "名称不能包含 @、#、空白或 .",
      path,
    });
  }
}

/**
 * 一个作用域（一个背包、一处场景陈列）里物品名唯一。
 *
 * 物品名就是地址，同名即无法指认；等价的多件是同一件东西的几份，用 `count` 表达。
 */
function checkItemNamesUnique(
  items: readonly { name: string }[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    checkEntityName(item.name, [...path, index, "name"], ctx);
    if (seen.has(item.name)) {
      ctx.addIssue({
        code: "custom",
        message: `同一个作用域里的物品名重复: ${item.name}（等价的多件请用 count）`,
        path: [...path, index, "name"],
      });
    }
    seen.add(item.name);
  });
}

/**
 * 角色名与场景名在 world 内全局唯一；撞名会让名字地址产生歧义。
 *
 * 道具按持有者 / 场景作用域唯一，不参与这条检查。
 */
function checkEntityNamesUnique(
  value: Pick<World, "stages" | "actors">,
  ctx: z.RefinementCtx,
): void {
  const seen = new Map<string, string[]>();
  const add = (name: string, kind: string) => {
    seen.set(name, [...(seen.get(name) ?? []), kind]);
  };
  for (const stage of value.stages) {
    add(stage.name, "场景");
  }
  for (const actor of value.actors) {
    add(actor.name, "角色");
  }
  for (const [name, kinds] of seen) {
    if (kinds.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: `名字重复: ${name}（${kinds.join(" / ")}）`,
        path: ["actors"],
      });
    }
  }
}

/**
 * 世界职能 agent 是内容层定档的成品，框架只确认它真的带上了这一局的设定与规则。
 *
 * 排版由内容负责；这里守的是「宪法必须吃世界设定」——否则材质名与术语会退回
 * 模型的世界外常识，而下游看不出题材越界。
 */
function checkFunctionPrompts(world: World, ctx: z.RefinementCtx): void {
  const seen = new Map<string, number>();
  for (const agent of world.functionAgents) {
    seen.set(agent.fn, (seen.get(agent.fn) ?? 0) + 1);
  }
  for (const fn of WORLD_FUNCTION_TYPES) {
    const count = seen.get(fn) ?? 0;
    if (count !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `世界职能 agent 必须恰好一个: ${fn}（当前 ${count} 个）`,
        path: ["functionAgents"],
      });
    }
  }
  for (const agent of world.functionAgents) {
    const fn = agent.fn;
    const prompt = agent.systemPrompt;
    const missing = [
      prompt.includes("## 职责") ? null : "职责",
      prompt.includes(world.campaignSetting) ? null : "战役设定",
      prompt.includes(world.globalRules) ? null : "全局规则",
      prompt.includes("## 本职能") ? null : "本职能",
    ].filter((item): item is string => item !== null);
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `世界职能 agent 的宪法缺少 ${missing.join("、")}: ${fn}`,
        path: ["functionAgents"],
      });
    }
  }
}

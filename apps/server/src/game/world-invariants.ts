import type { z } from "zod";
import { findTextLeaks } from "./text-guard";
import type { World } from "./world-definition";

/**
 * 跨实体的内容不变量：名字、文本泄漏、锚点与能力清单。
 *
 * 这些规则都要看整张世界图，所以不塞回 `world-schema.ts` 的形状里；
 * 由 `parse-world-content.ts` 在解析时统一执行。
 */
export function checkWorldInvariants(world: World, ctx: z.RefinementCtx): void {
  // 名字就是名字：角色与场景在 world 内全局唯一，且不能带系统标记字符。
  checkEntityNamesUnique(world, ctx);
  const actorNames = world.actors.map((actor) => actor.name);
  world.stages.forEach((stage, index) => {
    checkEntityName(stage.name, ["stages", index, "name"], ctx);
    stage.items?.forEach((item, itemIndex) => {
      checkEntityName(item.name, ["stages", index, "items", itemIndex, "name"], ctx);
    });
    const leaks = findTextLeaks(stage.environment, actorNames);
    if (leaks.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `environment 不能包含角色名或系统引用（@ / #编号）: ${leaks
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
          message: `锚点不能包含角色名或系统引用（@ / #编号）: ${anchorLeaks
            .map((leak) => leak.token)
            .join("、")}`,
          path: ["stages", index, "anchors", anchorIndex],
        });
      }
    });
  });
  world.actors.forEach((actor, index) => {
    checkEntityName(actor.name, ["actors", index, "name"], ctx);
    actor.items.forEach((item, itemIndex) => {
      checkEntityName(item.name, ["actors", index, "items", itemIndex, "name"], ctx);
    });
  });
}

/** 名字里不能出现系统标记：`@` 是名字引用，`#` 是匿名编号，点号是旧前缀分隔符。 */
function checkEntityName(raw: string, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (/[@#\s.]/.test(raw)) {
    ctx.addIssue({
      code: "custom",
      message: "名称不能包含 @、#、空白或 .",
      path,
    });
  }
}

/**
 * 角色名与场景名在 world 内全局唯一；撞名会让 `@名字` 的引用产生歧义。
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

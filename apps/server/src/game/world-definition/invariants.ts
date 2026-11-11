import type { z } from "zod";
import { findStageNameLeaks, findTextLeaks, NAME_MARKER_PATTERN } from "../kernel/addressing";
import type { Actor, World } from "../world-definition";

/**
 * 跨实体的内容不变量：名字、文本泄漏、锚点与能力清单。
 *
 * 这些规则都要看整张世界图，所以不塞回 `schema.ts` 的 zod 形状里；
 * 由 `index.ts` 接在形状之后执行。
 */
export function checkWorldInvariants(world: World, ctx: z.RefinementCtx): void {
  // 职能宪法由内容层定档，但框架要确认它真的带上了这一局的设定与规则。
  checkFunctionPrompts(world, ctx);
  // 名字就是名字：角色与场景在 world 内全局唯一，且不能带系统标记字符。
  checkEntityNamesUnique(world, ctx);
  // key 是内容引用实体的唯一方式：重复会静默指向另一样东西，宁可解析失败也不猜。
  checkKeysUnique(world, ctx);
  const actorNames = world.actors.map((actor) => actor.name);
  const stageNames = world.stages.map((stage) => stage.name);
  // 环境文本只能点名「从本场景走得到的场景」；未通的通道对面叫什么，要靠发现与对话浮出来。
  const visibleStageNames = (stageKey: string): Set<string> => {
    const visible = new Set<string>();
    for (const stage of world.stages) {
      if (stage.key === stageKey) {
        visible.add(stage.name);
      }
    }
    for (const connection of world.connections) {
      if (connection.passage !== undefined && connection.passage !== "open") {
        continue;
      }
      if (connection.from === stageKey || connection.to === stageKey) {
        const neighbor = world.stages.find(
          (stage) => stage.key === (connection.from === stageKey ? connection.to : connection.from),
        );
        if (neighbor) {
          visible.add(neighbor.name);
        }
      }
    }
    return visible;
  };
  world.stages.forEach((stage, index) => {
    checkEntityName(stage.name, ["stages", index, "name"], ctx);
    const leaks = [
      ...findTextLeaks(stage.environment, actorNames),
      ...findStageNameLeaks(stage.environment, stageNames, visibleStageNames(stage.key)),
    ];
    if (leaks.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `environment 不能包含角色名、编号引用或尚未打通的场景名: ${leaks
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
    const anchorKeys = new Set<string>();
    stage.anchors?.forEach((anchor, anchorIndex) => {
      if (anchorKeys.has(anchor.key)) {
        ctx.addIssue({
          code: "custom",
          message: `锚点 key 重复: ${anchor.key}`,
          path: ["stages", index, "anchors", anchorIndex, "key"],
        });
      }
      anchorKeys.add(anchor.key);
      checkItemNamesUnique(
        anchor.items ?? [],
        ["stages", index, "anchors", anchorIndex, "items"],
        ctx,
      );
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
    checkItemNamesUnique(actor.inventory, ["actors", index, "inventory"], ctx);
    checkProficiencies(actor, index, ctx);
  });
}

/**
 * 技艺是动作的第二个来源，所以一个动作只能有一个出处。
 *
 * 写在 `actions` 里的动作不能再被技艺带一遍，两项技艺也不能带同一个动作：
 * 重复不产生额外授权，只让「谁给了这个动作」变得说不清。
 */
function checkProficiencies(actor: Actor, actorIndex: number, ctx: z.RefinementCtx): void {
  const owner = new Map<string, string>();
  for (const action of actor.actions) {
    owner.set(action, "actions");
  }
  const seen = new Set<string>();
  actor.proficiencies?.forEach((skill, index) => {
    const path = ["actors", actorIndex, "proficiencies", index];
    if (seen.has(skill.key)) {
      ctx.addIssue({
        code: "custom",
        message: `技艺 key 重复: ${skill.key}`,
        path: [...path, "key"],
      });
    }
    seen.add(skill.key);
    for (const action of skill.actions) {
      const existing = owner.get(action);
      if (existing !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `动作 ${action} 已经有来源（${existing}），不能重复声明`,
          path: [...path, "actions"],
        });
      }
      owner.set(action, skill.name);
    }
  });
}

/**
 * 名字要在句子里被当成一个整体扫出来：不能含地址标记 `#`，也不能含空白与 `.`——
 * 它们会把名字切成两半，或与句读混在一起。
 */
function checkEntityName(raw: string, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (NAME_MARKER_PATTERN.test(raw) || /[\s.]/.test(raw)) {
    ctx.addIssue({
      code: "custom",
      message: "名称不能包含 #、空白或 .",
      path,
    });
  }
}

/**
 * 一个作用域（一个背包、一个锚点）里物品名唯一。
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
 * 内容 key 的唯一性。
 *
 * key 是内容引用 actor / stage / item 的唯一方式（行为与内容判定都按 key 找），重复会
 * 静默指向另一样东西，所以这里一并拒绝。物品 key 跨锚点与背包全局唯一，与「物品名按
 * 作用域唯一」是两条不同的规则：名字是地址，key 是引用。
 */
function checkKeysUnique(world: World, ctx: z.RefinementCtx): void {
  const checkEntityKeys = (
    entries: readonly { key: string }[],
    path: (string | number)[],
    label: string,
  ): void => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const key = entry.key.trim();
      if (key.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `${label} key 不能为空`,
          path: [...path, index, "key"],
        });
        return;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `重复的 ${label} key: ${key}`,
          path: [...path, index, "key"],
        });
      }
      seen.add(key);
    });
  };

  checkEntityKeys(world.stages, ["stages"], "stage");
  checkEntityKeys(world.actors, ["actors"], "actor");

  const items = [
    ...world.stages.flatMap((stage, stageIndex) =>
      (stage.anchors ?? []).flatMap((anchor, anchorIndex) =>
        (anchor.items ?? []).map((item, itemIndex) => ({
          item,
          path: ["stages", stageIndex, "anchors", anchorIndex, "items", itemIndex, "key"],
        })),
      ),
    ),
    ...world.actors.flatMap((actor, actorIndex) =>
      actor.inventory.map((item, itemIndex) => ({
        item,
        path: ["actors", actorIndex, "inventory", itemIndex, "key"],
      })),
    ),
  ];
  const seenItems = new Set<string>();
  for (const { item, path } of items) {
    const key = item.key.trim();
    if (key.length === 0) {
      ctx.addIssue({ code: "custom", message: "物品 key 不能为空", path });
      continue;
    }
    if (seenItems.has(key)) {
      ctx.addIssue({ code: "custom", message: `重复的物品 key: ${key}`, path });
    }
    seenItems.add(key);
  }
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
 * 世界职能宪法是内容层定档的成品，框架只确认它真的带上了这一局的设定与规则。
 *
 * 「每个职能恰好一段」由形状保证（`functionPrompts` 是每键必填的记录），这里守的是
 * 「宪法必须吃世界设定」——否则材质名与术语会退回模型的世界外常识，而下游看不出题材越界。
 */
function checkFunctionPrompts(world: World, ctx: z.RefinementCtx): void {
  for (const [fn, prompt] of Object.entries(world.functionPrompts)) {
    const missing = [
      prompt.includes("## 职责") ? null : "职责",
      prompt.includes(world.campaignSetting) ? null : "战役设定",
      prompt.includes(world.globalRules) ? null : "全局规则",
      prompt.includes("## 本职能") ? null : "本职能",
    ].filter((item): item is string => item !== null);
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `世界职能宪法缺少 ${missing.join("、")}: ${fn}`,
        path: ["functionPrompts"],
      });
    }
  }
}

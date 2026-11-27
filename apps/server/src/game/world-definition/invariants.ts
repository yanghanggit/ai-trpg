import type { z } from "zod";
import { findStageNameLeaks, findTextLeaks, NAME_MARKER_PATTERN } from "../kernel/addressing";
import { FINAL_STAT_KEYS, STAT_KEYS } from "../kernel/attributes";
import { EFFECT_STAT_KEYS } from "../kernel/status-effects";
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
  // 名字就是名字：角色与舞台在 world 内全局唯一，且不能带系统标记字符。
  checkEntityNamesUnique(world, ctx);
  // 设定里写了别人的真名，就必须同时把这条认知写成称呼：真名不是自动知识。
  checkActorCognitionNames(world, ctx);
  // key 是内容引用实体的唯一方式：重复会静默指向另一样东西，宁可解析失败也不猜。
  checkKeysUnique(world, ctx);
  const actorNames = world.actors.map((actor) => actor.name);
  const stageNames = world.stages.map((stage) => stage.name);
  // 环境文本只能点名「从本舞台走得到的舞台」；未通的通道对面叫什么，要靠发现与对话浮出来。
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
        message: `environment 不能包含角色名、编号引用或尚未打通的舞台名: ${leaks
          .map((leak) => leak.token)
          .join("、")}`,
        path: ["stages", index, "environment"],
      });
    }
    if (!stage.actions.includes("submit_environment")) {
      ctx.addIssue({
        code: "custom",
        message: "每个舞台都必须声明 submit_environment",
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
      const anchorLeaks = [
        ...findTextLeaks([anchor.label, anchor.description ?? ""].join("\n"), actorNames),
        ...findStageNameLeaks(
          [anchor.label, anchor.description ?? ""].join("\n"),
          stageNames,
          visibleStageNames(stage.key),
        ),
      ];
      if (anchorLeaks.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `锚点不能包含角色名、编号引用或尚未打通的舞台名: ${anchorLeaks
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
    checkActorSourcesOnly(actor, index, ctx);
    checkStatusEffects(actor, index, ctx);
    checkActorStageNames(actor, index, visitedStageKeys(world), visibleStageNames, stageNames, ctx);
  });
}

/**
 * 角色自己的文本（设定、开局简报）只能点名它去过或看得见的相邻舞台。
 *
 * 与舞台 environment 同一条规则，只是允许集从「这个舞台」换成「这个角色」：起点算去过，
 * 开局到访算去过，其余只到看得见的相邻舞台为止。再远的地名得靠走到、听到或查到，
 * 不能让设定替它宣布发现。同名是常用词时，写清楚它看得见的样子即可。
 *
 * 同样只认完全相同的舞台名：换一种说法就漏过去了。它回答的是「名字有没有越界」，
 * 不回答「这句话该不该写」。外观与形态更严：谁都能看见，所以一个舞台名都不能有。
 */
function checkActorStageNames(
  actor: Actor,
  actorIndex: number,
  visited: ReadonlyMap<string, ReadonlySet<string>>,
  visibleStageNames: (stageKey: string) => Set<string>,
  stageNames: readonly string[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>([actor.stageKey, ...(visited.get(actor.key) ?? [])]);
  const allowed = new Set<string>();
  for (const stageKey of seen) {
    for (const name of visibleStageNames(stageKey)) {
      allowed.add(name);
    }
  }
  const fields = [
    { key: "profile" as const, text: actor.profile },
    { key: "openingBriefing" as const, text: actor.openingBriefing ?? "" },
  ];
  for (const field of fields) {
    const leaks = findStageNameLeaks(field.text, stageNames, allowed);
    if (leaks.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `actor「${actor.name}」的 ${field.key} 提到了它没去过、也看不见的舞台: ${leaks
          .map((leak) => leak.token)
          .join("、")}；先补 visitedStages，或改写成它看得见的样子`,
        path: ["actors", actorIndex, field.key],
      });
    }
  }

  // 外观与形态是所有看见它的人都会读到的一句话：没有允许集，任何舞台名都不行，
  // 否则一个人站在那里就能替旁人宣布地名。
  const appearanceLeaks = findStageNameLeaks(
    [actor.signature.form, actor.signature.appearance ?? ""].join("\n"),
    stageNames,
    new Set<string>(),
  );
  if (appearanceLeaks.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `actor「${actor.name}」的形态与外观不能包含舞台名: ${appearanceLeaks
        .map((leak) => leak.token)
        .join("、")}；外观谁都能看见，不能替旁人宣布地名`,
      path: ["actors", actorIndex, "signature"],
    });
  }
}

/** `visitedStages` 按 actor 分组；只用作内容校验的允许集。 */
function visitedStageKeys(world: World): Map<string, Set<string>> {
  const visited = new Map<string, Set<string>>();
  for (const visit of world.visitedStages ?? []) {
    const stages = visited.get(visit.actor) ?? new Set<string>();
    stages.add(visit.stage);
    visited.set(visit.actor, stages);
  }
  return visited;
}

/**
 * 状态效果只调整有结算读点的源属性。
 *
 * 终值属于道具；智慧与生命上限没有读取点。允许写下去会得到「写了却不生效」的静默错，
 * 和角色自带终值一样直接拒绝：效果能改什么，在这里只定义一次。
 */
function checkStatusEffects(actor: Actor, actorIndex: number, ctx: z.RefinementCtx): void {
  const allowed = new Set<string>(EFFECT_STAT_KEYS);
  const seen = new Set<string>();
  actor.statusEffects?.forEach((effect, index) => {
    const path = ["actors", actorIndex, "statusEffects", index];
    if (seen.has(effect.key)) {
      ctx.addIssue({
        code: "custom",
        message: `状态效果 key 重复: ${effect.key}`,
        path: [...path, "key"],
      });
    }
    seen.add(effect.key);
    for (const key of STAT_KEYS) {
      if (allowed.has(key) || (effect.stats?.[key] ?? 0) === 0) {
        continue;
      }
      ctx.addIssue({
        code: "custom",
        message: `状态效果不能调整 ${key}：v1 只调整有读点的源属性（${EFFECT_STAT_KEYS.join("/")}）`,
        path: [...path, "stats", key],
      });
    }
  });
}

/**
 * 角色只带源属性：`damage` / `block` 是终值，结算期由源属性现算，只有道具能声明。
 *
 * 允许内容写下去会得到「写了却不生效」的静默错，所以直接拒绝——防御来自穿戴、
 * 攻击力来自力量这类口径归玩法层，不归内容。
 */
function checkActorSourcesOnly(actor: Actor, actorIndex: number, ctx: z.RefinementCtx): void {
  for (const key of FINAL_STAT_KEYS) {
    if (actor.stats[key] === 0) {
      continue;
    }
    ctx.addIssue({
      code: "custom",
      message: `角色不能自带终值 ${key}：它由源属性现算，终值只属于道具`,
      path: ["actors", actorIndex, "stats", key],
    });
  }
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
    if (owner.has(action)) {
      ctx.addIssue({
        code: "custom",
        message: `动作 ${action} 在 actions 里重复声明`,
        path: ["actors", actorIndex, "actions"],
      });
    }
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

  // 隐匿或藏身是内容给的状态/能力；主动现身必须同时由内容声明，运行时不会补动作。
  const merged = new Set([
    ...actor.actions,
    ...(actor.proficiencies ?? []).flatMap((skill) => skill.actions),
  ]);
  if (((actor.concealed ?? false) || merged.has("hide")) && !merged.has("reveal")) {
    ctx.addIssue({
      code: "custom",
      message: "声明了 concealed 或 hide，就必须同时声明 reveal：运行时不会补动作",
      path: ["actors", actorIndex, "actions"],
    });
  }
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
 * 一个作用域（一个背包、一个锚点）里道具名唯一。
 *
 * 道具名就是地址，同名即无法指认；等价的多件是同一件东西的几份，用 `count` 表达。
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
        message: `同一个作用域里的道具名重复: ${item.name}（等价的多件请用 count）`,
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
 * 静默指向另一样东西，所以这里一并拒绝。道具 key 跨锚点与背包全局唯一，与「道具名按
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
      ctx.addIssue({ code: "custom", message: "道具 key 不能为空", path });
      continue;
    }
    if (seenItems.has(key)) {
      ctx.addIssue({ code: "custom", message: `重复的道具 key: ${key}`, path });
    }
    seenItems.add(key);
  }
}

/**
 * 角色设定与开局简报里出现别人的真名，必须有对应的开局称呼。
 *
 * 设定是 actor 会读到的内容：写下真名等于直接告诉它这个名字。真名的合法来源只有
 * 开局称呼声明（内容层授权）与世界内告知（运行时写进记忆），所以这里要求
 * 「用了谁的真名，就有一条观察者→该签名、名字等于真名的 `signatureNames`」。
 * 只想保留关系、不想给名字时，改写成它自己的叫法（称号、相貌、编号），
 * 让名字留到自我介绍或互动里再获得。
 *
 * 只认完全相同的真名：同义说法、缩写与别名改得掉检查。这里挡的是常见笔误，
 * 不构成「角色真的知道这个名字」的证明；写对了结构不等于写对了设定。
 */
function checkActorCognitionNames(world: World, ctx: z.RefinementCtx): void {
  const boundNames = new Set(
    (world.signatureNames ?? []).map(
      (binding) => `${binding.observer}\u0000${binding.subject}\u0000${binding.name}`,
    ),
  );
  world.actors.forEach((actor, actorIndex) => {
    const fields = [
      { key: "profile" as const, text: actor.profile },
      { key: "openingBriefing" as const, text: actor.openingBriefing ?? "" },
    ];
    for (const field of fields) {
      for (const subject of world.actors) {
        if (subject.key === actor.key || !field.text.includes(subject.name)) {
          continue;
        }
        if (boundNames.has(`${actor.key}\u0000${subject.key}\u0000${subject.name}`)) {
          continue;
        }
        ctx.addIssue({
          code: "custom",
          message: `actor「${actor.name}」的 ${field.key} 写了「${subject.name}」，但没有对应的开局称呼；补一条 { observer: "${actor.key}", subject: "${subject.key}", name: "${subject.name}" }，或改写成它自己的叫法（称号、相貌），把名字留给自我介绍与互动`,
          path: ["actors", actorIndex, field.key],
        });
      }
    }
  });
}

/**
 * 角色名与舞台名在 world 内全局唯一；撞名会让名字地址产生歧义。
 *
 * 道具按持有者 / 舞台作用域唯一，不参与这条检查。
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
    add(stage.name, "舞台");
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

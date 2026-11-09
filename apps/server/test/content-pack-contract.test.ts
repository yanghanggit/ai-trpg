import { describe, expect, it } from "vitest";
import { CONTENT_PACKS } from "../seeds";
import { CARRIED_ACTION_KINDS, INNATE_ACTION_KINDS } from "../src/game/actions";
import { parseWorldContent } from "../src/game/world-content";

/**
 * 内容包契约：与具体剧本无关的结构约束，对仓库里每一个剧本都跑一遍。
 *
 * 新剧本只要在 `seeds/index.ts` 注册就会自动进入这份检查，不需要再补一份用例；
 * 剧本自己的叙事与数值断言放各自的 `<script>.test.ts`。
 */
const packs = Object.entries(CONTENT_PACKS);

describe.each(packs)("content pack %s", (_name, pack) => {
  const world = parseWorldContent(pack.world);
  const items = [
    ...world.actors.flatMap((actor) => actor.inventory),
    ...world.stages.flatMap((stage) =>
      (stage.anchors ?? []).flatMap((anchor) => anchor.items ?? []),
    ),
  ];

  it("keeps carried actions on weapons, never on actors", () => {
    for (const item of items) {
      for (const kind of item.actions ?? []) {
        expect(CARRIED_ACTION_KINDS).toContain(kind);
      }
      if ((item.actions ?? []).length > 0) {
        expect(item.kind).toBe("weapon");
      }
    }
    for (const actor of world.actors) {
      for (const kind of actor.actions) {
        expect(INNATE_ACTION_KINDS).toContain(kind);
      }
    }
  });

  it("declares a matching affix trigger for every granted attack", () => {
    for (const item of items) {
      for (const kind of item.actions ?? []) {
        expect(item.affixes?.[kind]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the cleave target cap inside the weapon and above one", () => {
    for (const item of items) {
      if (item.actions?.includes("cleave")) {
        expect(item.maxTargets).toBeGreaterThanOrEqual(2);
      } else {
        // 没有横扫的武器不该写多目标上限：strike 永远是单体。
        expect(item.maxTargets ?? 1).toBe(1);
      }
    }
  });

  it("points every equipped slot at an item the actor actually owns", () => {
    for (const actor of world.actors) {
      for (const name of Object.values(actor.equipment ?? {})) {
        expect(actor.inventory.some((item) => item.name === name)).toBe(true);
      }
    }
  });
});

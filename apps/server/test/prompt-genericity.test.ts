import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { MECHANISM_TERMS } from "../src/game/mechanism-terms";

/**
 * 框架层（内容定义之外）只能写通用规则：故事专名与具体机关样例一旦写进
 * prompt / 工具描述，就等于把一个剧本的战役设定固化进系统。
 *
 * 这里用当前 seed 的专名做反向守卫；换剧本时自动跟随，不需要改测试。
 */
const FRAMEWORK_ROOTS = ["src", "scripts"];

/** 只在框架层不该出现的“具体机构部件”样例词；通用表达请用语义描述。 */
const CONCRETE_MECHANISM_SAMPLES = ["锁孔", "门闩", "铭文", "炉膛", "表面纹样"];

/** 题材化的伤害类型与身体材料：换一个剧本就不再成立，prompt 里只能写语义。 */
const GENRE_SAMPLES = [
  "灼烧",
  "冻伤",
  "腐蚀",
  "焦黑",
  "毛皮",
  "鳞片",
  "獠牙",
  "骨骸",
  "血迹",
  "伤口",
  "伤疤",
  "伤势",
  "污渍",
  "绷带",
  "斗篷",
];

/**
 * 审查器要在 rubric 里点名「什么样的词算内容词」，引用黑名单是它的本职。
 * 这是唯一豁免的文件：它不把词用进提示词，只把它们当作判据的对照样例。
 */
const QUOTES_BLACKLIST = ["src/dev/prompt-audit.ts"];

function storyTokens(): string[] {
  // 世界名同样不能出现在框架层提示词里。
  const tokens = new Set<string>([BELL_MONASTERY_WORLD.worldName]);
  for (const stage of BELL_MONASTERY_WORLD.stages) {
    tokens.add(stage.name);
    for (const anchor of stage.anchors ?? []) {
      for (const item of anchor.items ?? []) {
        tokens.add(item.name);
      }
    }
  }
  for (const actor of BELL_MONASTERY_WORLD.actors) {
    tokens.add(actor.name);
    for (const item of actor.inventory) {
      tokens.add(item.name);
    }
  }
  return [...tokens].filter((token) => token.length > 1);
}

function frameworkFiles(root: string): string[] {
  const full = join(import.meta.dirname, "..", root);
  const files: string[] = [];
  for (const entry of readdirSync(full)) {
    const path = join(full, entry);
    if (statSync(path).isDirectory()) {
      files.push(...frameworkFiles(join(root, entry)));
    } else if (entry.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("framework prompts stay content-agnostic", () => {
  const files = FRAMEWORK_ROOTS.flatMap((root) => frameworkFiles(root))
    .map((path) => ({ path, body: readFileSync(path, "utf8") }))
    .map((file) => ({
      ...file,
      path: relative(join(import.meta.dirname, ".."), file.path)
        .split("\\")
        .join("/"),
    }));
  /** 内容词扫描只跳过引用黑名单的那一份文件；专名扫描不受影响。 */
  const promptFiles = files.filter((file) => !QUOTES_BLACKLIST.includes(file.path));

  it("never names the current seed's stages, actors or items", () => {
    const hits = files.flatMap(({ path, body }) =>
      storyTokens()
        .filter((token) => body.includes(token))
        .map((token) => `${path}: ${token}`),
    );
    expect(hits).toEqual([]);
  });

  it("uses semantic descriptions instead of concrete mechanism samples", () => {
    const hits = promptFiles.flatMap(({ path, body }) =>
      CONCRETE_MECHANISM_SAMPLES.filter((sample) => body.includes(sample)).map(
        (sample) => `${path}: ${sample}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("keeps the blacklists disjoint from the mechanism vocabulary", () => {
    // 黑名单与 `docs/data-driven.md` 的「题材包络」必须不打架：把机制词（工具名、
    // 动作标签、属性名、状态词）写进黑名单，等于让确定性守卫去报语义审查已经豁免的词。
    const blacklist = [...CONCRETE_MECHANISM_SAMPLES, ...GENRE_SAMPLES];
    const overlap = blacklist.filter((sample) =>
      MECHANISM_TERMS.some((term) => term === sample || term.includes(sample)),
    );

    expect(overlap).toEqual([]);
  });

  it("does not bake a genre's damage types or body materials into prompts", () => {
    const hits = promptFiles.flatMap(({ path, body }) =>
      GENRE_SAMPLES.filter((sample) => body.includes(sample)).map((sample) => `${path}: ${sample}`),
    );
    expect(hits).toEqual([]);
  });
});

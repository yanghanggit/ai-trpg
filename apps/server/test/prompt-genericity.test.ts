import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";

/**
 * 框架层（内容定义之外）只能写通用规则：故事专名与具体机关样例一旦写进
 * prompt / 工具描述，就等于把一个剧本的世界观固化进系统。
 *
 * 这里用当前 seed 的专名做反向守卫；换剧本时自动跟随，不需要改测试。
 */
const FRAMEWORK_ROOTS = ["src", "scripts"];

/** 只在框架层不该出现的“具体机构部件”样例词；通用表达请用语义描述。 */
const CONCRETE_MECHANISM_SAMPLES = ["锁孔", "门闩", "铭文", "炉膛", "表面纹样"];

/** 题材化的伤害类型与身体材料：换一个剧本就不再成立，prompt 里只能写语义。 */
const GENRE_SAMPLES = ["灼烧", "冻伤", "腐蚀", "焦黑", "毛皮", "鳞片", "獠牙", "骨骸"];

function storyTokens(): string[] {
  // 世界名同样不能出现在框架层提示词里。
  const tokens = new Set<string>([BELL_MONASTERY_WORLD.worldName]);
  for (const stage of BELL_MONASTERY_WORLD.stages) {
    tokens.add(stage.name);
    for (const item of stage.items ?? []) {
      tokens.add(item.name);
    }
  }
  for (const actor of BELL_MONASTERY_WORLD.actors) {
    tokens.add(actor.name);
    for (const item of actor.items) {
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
  const files = FRAMEWORK_ROOTS.flatMap((root) => frameworkFiles(root)).map((path) => ({
    path,
    body: readFileSync(path, "utf8"),
  }));

  it("never names the current seed's stages, actors or items", () => {
    const hits = files.flatMap(({ path, body }) =>
      storyTokens()
        .filter((token) => body.includes(token))
        .map((token) => `${path}: ${token}`),
    );
    expect(hits).toEqual([]);
  });

  it("uses semantic descriptions instead of concrete mechanism samples", () => {
    const hits = files.flatMap(({ path, body }) =>
      CONCRETE_MECHANISM_SAMPLES.filter((sample) => body.includes(sample)).map(
        (sample) => `${path}: ${sample}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("does not bake a genre's damage types or body materials into prompts", () => {
    const hits = files.flatMap(({ path, body }) =>
      GENRE_SAMPLES.filter((sample) => body.includes(sample)).map((sample) => `${path}: ${sample}`),
    );
    expect(hits).toEqual([]);
  });
});

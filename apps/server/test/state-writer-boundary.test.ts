import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GAME_DIR = fileURLToPath(new URL("../src/game", import.meta.url));

/**
 * 拉取循环的写者约束：状态只由拥有它的回合写，其它 agent 只能读。
 *
 * 这里守的是“写入点唯一”，不是“谁可以 import”——后者由持久化边界守。
 * 新增状态时，要么在这里登记它的唯一写者，要么先想清楚为什么它需要多个写者。
 */
const STATE_WRITERS: readonly { name: string; allowed: readonly string[] }[] = [
  { name: "setStageEnvironment", allowed: ["stage-turn/effects.ts"] },
  { name: "recordAppearance", allowed: ["appearance/record.ts", "create-game/actors.ts"] },
  { name: "openPassage", allowed: ["stage-turn/effects.ts"] },
  { name: "completeGameIfActive", allowed: ["world-turn/arbitrate.ts"] },
];

/**
 * 跨 owner 写记忆只有一条通道：world memory 只能由 world 自己的回合读，
 * 其余的读都收在 `memory/world-channel.ts`。其他模块要告诉 world 什么，
 * 只调通道函数，不自己 `loadAgentMemory` 再往里写。
 */
const WORLD_MEMORY_ACCESS: readonly string[] = [
  "memory/world-channel.ts",
  "world-turn/turn.ts",
  "world-turn/arbitrate.ts",
];

/**
 * 暂未加守卫：stage memory 的写入。
 *
 * 观察原语（`observations/`）是它目前唯一的入口，但这只靠约定：漏网形态是「拿到别人的
 * memory row 后直接 appendMemoryMessages」，源码扫描看不住。等 `observations/` 成为
 * 独立主题，或把 `appendMemoryMessages` 收窄到观察与压缩两处时一并收。
 */

function listTsFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return listTsFiles(join(dir, entry.name), relative);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [relative] : [];
  });
}

function callSites(relative: string, writer: string): number[] {
  const lines = readFileSync(join(GAME_DIR, relative), "utf8").split("\n");
  const call = new RegExp(`\\b${writer}\\(`);
  const declaration = new RegExp(`function\\s+${writer}\\b`);
  return lines.flatMap((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("import") || declaration.test(line)) {
      return [];
    }
    return call.test(line) ? [index + 1] : [];
  });
}

describe("状态写入边界", () => {
  it("keeps single-writer state inside its owning turn", () => {
    const files = listTsFiles(GAME_DIR);
    const offenders = STATE_WRITERS.flatMap(({ name, allowed }) =>
      files
        .filter((relative) => !allowed.includes(relative))
        .flatMap((relative) =>
          callSites(relative, name).map((line) => `${relative}:${line} ${name}`),
        ),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps world memory behind the channel", () => {
    const pattern = /loadAgentMemory\([^)]*"world"/;
    const offenders = listTsFiles(GAME_DIR)
      .filter((relative) => !WORLD_MEMORY_ACCESS.includes(relative))
      .filter((relative) => pattern.test(readFileSync(join(GAME_DIR, relative), "utf8")));

    expect(offenders).toEqual([]);
  });
});

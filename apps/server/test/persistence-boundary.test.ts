import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GAME_DIR = fileURLToPath(new URL("../src/game", import.meta.url));

/**
 * 允许直接 import drizzle / 表定义的模块：存取层与编排层。
 *
 * - `settle/`：计划解析与结算事务边界（计算端 + 推理端）；
 * - `lookup/`：解析动作用的带策略只读查询；
 * - `persistence/`：具名读写原语，含玩家接管关系；
 * - `memory/` / `compact/`：记忆读写（行映射、存储、注入文本）与压缩；
 * - `create-game/`：建局（内容 → 行的物化）；`game-state/`：整局状态装配。
 *
 * 玩法模块（`actions/`、`items/`、`combat/`、`stage`/`world` 回合、死亡、外观、观察）不在名单里，
 * 它们只调用具名函数。
 */
const ALLOWED = [
  "settle/",
  "lookup/",
  "persistence/",
  "game-state/",
  "memory/",
  "compact/",
  "create-game/",
];

function listTsFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return listTsFiles(join(dir, entry.name), relative);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [relative] : [];
  });
}

describe("持久化边界", () => {
  it("keeps SQL and table names out of gameplay modules", () => {
    const offenders = listTsFiles(GAME_DIR)
      .filter((relative) => !ALLOWED.some((allowed) => relative.startsWith(allowed)))
      .filter((relative) => {
        const source = readFileSync(join(GAME_DIR, relative), "utf8");
        return source.includes("drizzle-orm") || source.includes("db/schema");
      });

    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GAME_DIR = fileURLToPath(new URL("../src/game", import.meta.url));

/**
 * 允许直接 import drizzle / 表定义的模块：存取层与编排层。
 *
 * - `apply/`：解析动作用的只读查询、事务边界、消息与版本号；
 * - `persistence/`：具名读写原语；
 * - `memory.ts` / `compact.ts`：记忆读写与压缩；
 * - `control.ts`：玩家接管关系；
 * - `service.ts`：建局与整局读取。
 *
 * 玩法模块（`actions/`、`item-effects/`、`stage`/`world` 回合、死亡、外观、观察）不在名单里，
 * 它们只调用具名函数。
 */
const ALLOWED = ["apply/", "persistence/", "memory.ts", "compact.ts", "control.ts", "service.ts"];

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

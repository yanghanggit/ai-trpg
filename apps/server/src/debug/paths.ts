import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 从 start 向上找到包含 pnpm-workspace.yaml 的仓库根目录。 */
export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

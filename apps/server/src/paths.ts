import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * 从当前目录向上找到仓库根（以 `pnpm-workspace.yaml` 为标记）。
 *
 * 运行期目录（worlds / stories / prompts / logs / images）都相对它定位，
 * 避免脚本从 `apps/server` 或仓库根启动时落到不同位置。
 */
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

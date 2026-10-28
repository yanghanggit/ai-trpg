import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMAGEGEN_ROOT = join(SERVER_ROOT, "src", "imagegen");
const PROVIDER_ROOT = join(IMAGEGEN_ROOT, "providers");

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

/**
 * 厂商名只允许出现在 provider 适配器里。领域层与 CLI 必须保持 provider 无关，
 * 否则「replicate」会以普通英文词的身份扩散，后续接入其它 provider 时难以区分。
 */
describe("imagegen provider boundary", () => {
  it("keeps the vendor proper noun inside provider adapters", () => {
    const offenders = collectFiles(IMAGEGEN_ROOT)
      .filter((path) => !path.startsWith(PROVIDER_ROOT))
      .filter((path) => /replicate/i.test(readFileSync(path, "utf8")))
      .map((path) => relative(SERVER_ROOT, path));

    expect(offenders).toEqual([]);
  });

  it("keeps the CLI provider-agnostic", () => {
    const cli = readFileSync(join(SERVER_ROOT, "scripts", "image.ts"), "utf8");
    expect(/replicate/i.test(cli)).toBe(false);
  });
});

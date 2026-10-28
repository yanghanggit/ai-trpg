import { describe, expect, it } from "vitest";
import {
  auditCacheKey,
  buildAuditRequest,
  extractPromptSnippets,
  parseAuditResponse,
} from "../src/dev/prompt-audit";

const SLOT = "$" + "{name}";
const SOURCE = [
  'import { readFileSync } from "./a-very-long-module-specifier-name";',
  "",
  "function buildThing(name: string): string {",
  `  return \`默认效果已经结算，${SLOT} 只是运行时插值，这段文字应当被抽出并折叠成占位符。\`;`,
  "}",
  "",
  'const tool = { description: "这段工具描述也必须接受题材无关性审查，长度足够触发提取。" };',
].join("\n");

describe("prompt audit", () => {
  it("extracts literal prose and folds interpolations", () => {
    const snippets = extractPromptSnippets("demo.ts", SOURCE);

    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toMatchObject({ file: "demo.ts", line: 4 });
    expect(snippets[0]?.text).toContain("⟨…⟩");
    expect(snippets[0]?.text).not.toContain("${");
    expect(snippets[1]).toMatchObject({ file: "demo.ts", line: 7 });
    expect(snippets.some((snippet) => snippet.text.includes("a-very-long"))).toBe(false);
  });

  it("groups findings by snippet id and tolerates missing fields", () => {
    const parsed = parseAuditResponse(`\`\`\`json
{"findings":[
  {"id":"s1","quote":"示例一","category":"setting-leak","severity":"high","reason":"r","suggestion":"s"},
  {"id":"s1","quote":"示例二","category":"mechanism-sample"},
  {"id":"s9","quote":"未知片段"}
]}
\`\`\``);

    expect(parsed.get("s1")).toHaveLength(2);
    expect(parsed.get("s1")?.[1]).toMatchObject({ severity: "high", reason: "" });
    expect(parsed.get("s9")).toHaveLength(1);
    expect(parsed.get("s2")).toBeUndefined();
  });

  it("rejects replies without a JSON object", () => {
    expect(() => parseAuditResponse("没有 JSON，只有一段说明")).toThrow();
  });

  it("keys the cache by text, model and rubric version", () => {
    expect(auditCacheKey("同一段文本", "flash")).toBe(auditCacheKey("同一段文本", "flash"));
    expect(auditCacheKey("同一段文本", "flash")).not.toBe(auditCacheKey("同一段文本", "pro"));
    expect(auditCacheKey("同一段文本", "flash")).not.toBe(auditCacheKey("另一段文本", "flash"));
  });

  it("builds a deterministic review request", () => {
    const request = buildAuditRequest({
      items: [{ id: "s1", text: "需要审查的示例文本。" }],
      model: "flash",
    });

    expect(request.model).toBe("flash");
    expect(request.temperature).toBe(0);
    expect(request.messages[0]?.content).toContain("框架层文本审查器");
    expect(request.messages[1]?.content).toContain("需要审查的示例文本。");
  });
});

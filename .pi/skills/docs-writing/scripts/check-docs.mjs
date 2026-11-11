#!/usr/bin/env node
/**
 * docs/ 的可机械判定部分：索引覆盖、链接有效、无围栏代码块、交叉引用写法、索引表对齐。
 *
 * 判据的所有者是 `docs/README.md` 的「写作约束」与「索引」；这里只把其中能由脚本
 * 判定的条目变成可执行检查，不新增规则、不复述规则文本。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DOCS = resolve(import.meta.dirname, "../../../../docs");
const INDEX = "README.md";

/** 中文按两列算，表格对齐才有意义。 */
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const displayWidth = (text) => [...text].reduce((sum, char) => sum + (WIDE.test(char) ? 2 : 1), 0);

const problems = [];
/** 行号缺失时只报文件，不编造 0。 */
const report = (file, line, message) =>
  problems.push(line === undefined ? `${file}: ${message}` : `${file}:${line}: ${message}`);

const files = readdirSync(DOCS)
  .filter((name) => name.endsWith(".md"))
  .sort();

// 1) 围栏代码块与交叉引用写法
const crossRef = /→ 参见：\[[^\]]+\]\([^)]+\)/;
for (const name of files) {
  const lines = readFileSync(join(DOCS, name), "utf8").split("\n");
  lines.forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(```|~~~)/.test(text)) {
      report(name, line, "不用围栏代码块，命令与类型用行内代码");
    }
    if (text.includes("→ 参见") && !crossRef.test(text)) {
      report(name, line, "交叉引用固定写作 → 参见：[文档标题](相对路径)");
    }
    if (text.includes("-> 参见")) {
      report(name, line, "交叉引用用的是 →，不是 ->");
    }
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      const path = resolve(DOCS, target);
      try {
        readFileSync(path);
      } catch {
        report(name, line, `链接指向不存在的文件：${target}`);
      }
    }
  });
}

/** 按「连续以 | 开头的行」切出表格块。 */
const tableBlocks = (lines) => {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith("|")) {
      current.push(line);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
};

/** 2) 索引表按列宽对齐：它是全库唯一按显示宽度排版的表，其余表各写各的风格。 */
const indexLines = readFileSync(join(DOCS, INDEX), "utf8").split("\n");
const indexTable = tableBlocks(indexLines).find((block) => block[0]?.startsWith("| 文档"));
if (indexTable) {
  const widths = new Set(indexTable.map(displayWidth));
  if (widths.size > 1) {
    report(
      INDEX,
      indexLines.indexOf(indexTable[0]) + 1,
      `索引表列宽不一致：${[...widths].join(" / ")}`,
    );
  }
}

/** 3) 索引覆盖：docs/ 下每个文档都在索引表里，索引表也不指向不存在的文档。 */
const indexed = new Set();
for (const text of indexLines) {
  for (const [, target] of text.matchAll(/^\|\s*\[[^\]]+\]\(([^)]+\.md)\)/g)) {
    indexed.add(target);
  }
}
for (const name of files) {
  if (name !== INDEX && !indexed.has(name)) {
    report(INDEX, undefined, `索引缺登记：${name}`);
  }
}
for (const target of indexed) {
  if (!files.includes(target)) {
    report(INDEX, undefined, `索引指向不存在的文档：${target}`);
  }
}

if (problems.length === 0) {
  process.stdout.write(`docs 检查通过：${files.length} 个文档\n`);
} else {
  process.stdout.write(`${problems.join("\n")}\n发现 ${problems.length} 处问题\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node
/**
 * 引擎概念用词的机械部分：框架层出现废弃说法即失败。
 *
 * 判据的所有者是 `docs/terminology.md` 的「已废弃的说法」表；这里只把那张表变成
 * 可执行检查，不新增规则、不复述规则文本。表加一行，检查就多一条。
 *
 * 扫描范围是框架自己写的文本。内容层的散文（seed 正文、知识库）不在此列：
 * 词表管的是「指代实体时用什么词」，不管叙述里能不能出现同一个汉字。
 *
 * 例外：`docs/terminology.md` 是词表的定义处，豁免；确需保留旧词的行，
 * 在同一行写 `terms-allow: <词>`。
 *
 * 这是手动检查，不接进 `pnpm lint`：发现只作为报告，退出码恒为 0，
 * 修不修由人决定。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../..");
const OWNER = "docs/terminology.md";
/** 行内的 `terms-allow: <词>` 只免除本行；它不改变别处，也不改变别的词。 */
const ALLOW = "terms-allow:";
const SCOPES = [
  "apps/server/src",
  "apps/server/scripts",
  "apps/server/seeds/global-rules.ts",
  "docs",
  "README.md",
];
const EXTENSIONS = [".ts", ".tsx", ".md", ".mjs"];

const problems = [];

/** 从所有者文档解析废弃表：表在「已废弃的说法」小节内，首列是废弃词。 */
function bannedTerms() {
  const body = readFileSync(join(ROOT, OWNER), "utf8");
  const start = body.indexOf("## 已废弃的说法");
  if (start === -1) {
    throw new Error(`${OWNER} 缺少「已废弃的说法」小节`);
  }
  const section = body.slice(start + 1);
  const end = section.indexOf("\n## ");
  const table = end === -1 ? section : section.slice(0, end);
  const terms = [];
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }
    const banned = /^`([^`]+)`$/.exec(cells[1]);
    const canonical = cells[2];
    if (banned && canonical) {
      terms.push({ banned: banned[1], canonical });
    }
  }
  if (terms.length === 0) {
    throw new Error(`${OWNER} 的废弃说法表没有可解析的行`);
  }
  return terms;
}

function* walk(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    yield* walk(join(path, entry));
  }
}

/** 英文词按词边界比，中文词按子串比；两者都不区分大小写。 */
function hit(text, term) {
  if (/^[A-Za-z]+$/.test(term)) {
    return new RegExp(`\\b${term}\\b`, "i").test(text);
  }
  return text.toLowerCase().includes(term.toLowerCase());
}

const terms = bannedTerms();
const files = SCOPES.flatMap((scope) => [...walk(join(ROOT, scope))]).filter((path) => {
  const name = relative(ROOT, path).split("\\").join("/");
  return name !== OWNER && EXTENSIONS.some((extension) => name.endsWith(extension));
});

for (const path of files) {
  const name = relative(ROOT, path).split("\\").join("/");
  const body = readFileSync(path, "utf8");
  body.split("\n").forEach((text, index) => {
    if (text.includes(ALLOW)) {
      return;
    }
    for (const { banned, canonical } of terms) {
      if (!hit(text, banned)) {
        continue;
      }
      problems.push(`${name}:${index + 1}: 用「${banned}」，正名是「${canonical}」`);
    }
  });
}

if (problems.length > 0) {
  console.log(problems.join("\n"));
  console.log(
    `\n发现 ${problems.length} 处待确认的用词，不阻断。正名与判据见 ${OWNER}；确需保留时在同一行写 terms-allow: <词>。`,
  );
  process.exit(0);
}

console.log(`用词检查通过：${terms.length} 条废弃说法，${files.length} 个文件`);

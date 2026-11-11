import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 一个工具在代码里有三个名字：`function.name`（模型契约）、builder 名、调用点局部变量。
 * 三者必须能机械互推，否则读 trace 时看到 `query` 要在脑子里翻译成 `knowledgeTool`。
 *
 * 规则见 `docs/agents.md` 的「工具构造」：
 *
 * - builder：`build` + CamelCase(工具名)，允许一个角色前缀（两个 agent 可能产出同名工具）；
 * - 局部变量：CamelCase(工具名) + `Tool`，不缩写；
 * - 多工具 bundle 的键名同局部变量。
 *
 * 只查这三条，工具描述与参数不在范围。
 */

const SRC = join(import.meta.dirname, "..", "src");

/** 角色前缀只用于区分同名工具，不参与派生。 */
const ROLE_PREFIX = /^(Actor|World|Stage)/;

const snake = (name: string): string => name.replace(/(?!^)(?=[A-Z])/g, "_").toLowerCase();

const camel = (name: string): string =>
  name.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });

/** 一个函数体里第一个 `name: "..."` 的字符串值。 */
const toolNameIn = (node: ts.Node, source: ts.SourceFile): string | undefined => {
  let found: string | undefined;
  const visit = (child: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isPropertyAssignment(child) &&
      ts.isIdentifier(child.name) &&
      child.name.text === "name" &&
      ts.isStringLiteralLike(child.initializer)
    ) {
      found = child.initializer.text;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  void source;
  return found;
};

/** builder 名 → 工具名。 */
const builders = new Map<string, string>();

describe("工具命名的三个名字互推", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    source: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true),
  }));

  it("build*Tool 的导出名是工具名的 CamelCase（允许角色前缀）", () => {
    const problems: string[] = [];
    for (const { path, source } of files) {
      for (const statement of source.statements) {
        if (!ts.isFunctionDeclaration(statement)) {
          continue;
        }
        const name = statement.name?.text;
        if (name === undefined || !/^build\w+Tool$/.test(name)) {
          continue;
        }
        const tool = toolNameIn(statement, source);
        if (tool === undefined) {
          problems.push(`${path}: ${name} 里找不到 function.name`);
          continue;
        }
        builders.set(name, tool);
        const stem = name.slice("build".length, -"Tool".length);
        const derived = snake(stem);
        if (derived !== tool && snake(stem.replace(ROLE_PREFIX, "")) !== tool) {
          problems.push(`${path}: ${name} → ${tool}（应为 ${camel(tool)}）`);
        }
      }
    }
    // 扫不到东西时三条用例会一起「通过」，所以给个下界：漏解析比误报更危险。
    expect(builders.size).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });

  it("调用点的局部变量由工具名派生，不缩写", () => {
    const problems: string[] = [];
    for (const { path, source } of files) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer !== undefined &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression)
        ) {
          const tool = builders.get(node.initializer.expression.text);
          if (tool !== undefined) {
            const expected = `${camel(tool)}Tool`;
            if (node.name.text !== expected) {
              problems.push(
                `${path}: ${node.name.text} = ${node.initializer.expression.text}() → ${tool}` +
                  `（应为 ${expected}）`,
              );
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
    }
    expect(problems).toEqual([]);
  });

  it("多工具 bundle 的键名同样由工具名派生", () => {
    const problems: string[] = [];
    for (const { path, source } of files) {
      for (const statement of source.statements) {
        if (!ts.isFunctionDeclaration(statement)) {
          continue;
        }
        const name = statement.name?.text;
        // 单数 `build*Tool` 已由上面的用例覆盖；这里只看返回一组工具的 builder。
        if (name === undefined || !/^build\w+Tools$/.test(name) || !statement.body) {
          continue;
        }
        const returned = statement.body.statements.find(ts.isReturnStatement)?.expression;
        if (returned === undefined || !ts.isObjectLiteralExpression(returned)) {
          continue;
        }
        for (const property of returned.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
            continue;
          }
          const tool = toolNameIn(property.initializer, source);
          if (tool === undefined) {
            problems.push(`${path}: ${name}.${property.name.text} 里找不到 function.name`);
            continue;
          }
          if (property.name.text !== camel(tool)) {
            problems.push(
              `${path}: ${name}.${property.name.text} → ${tool}（应为 ${camel(tool)}）`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

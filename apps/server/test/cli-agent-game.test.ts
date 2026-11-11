/**
 * `agent-game` CLI 的参数层守卫：帮助、退出码、参数归属与用法错误文案。
 *
 * 不覆盖业务结果（那属于 `game` 服务层的用例）；这里只钉住「用法错误在打开数据库之前
 * 就被拦住」与「stdout 始终是 JSON 信封（帮助/版本除外）」这两条契约。
 */

import { describe, expect, it, vi } from "vitest";
import { runAgentGameCli } from "../src/cli/agent-game";

type CliRun = { code: number; stdout: string; stderr: string };

/** 直接驱动入口函数，不 fork 进程：避免 tsx 启动开销，同时能断言退出码。 */
async function run(argv: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  try {
    const code = await runAgentGameCli(argv);
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

function jsonOf(result: CliRun): Record<string, unknown> {
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("agent-game CLI", () => {
  it("--help 列出按用途分组的子命令", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: agent-game");
    for (const group of ["建局与读取", "玩家动作", "回合推进", "排查与维护", "轨迹"]) {
      expect(result.stdout).toContain(group);
    }
    expect(result.stdout).toContain("player-recognize-identity");
    expect(result.stdout).toContain("ask-route");
    expect(result.stdout).toContain("visited-stages");
  });

  it("-v 打印版本", async () => {
    const result = await run(["-v"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("子命令 help 只列该命令的参数", async () => {
    const result = await run(["player-say", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: agent-game player-say");
    expect(result.stdout).toContain("--message <text>");
    expect(result.stdout).not.toContain("--slot");
  });

  it("未知命令退出码 2，action 保留用户输入", async () => {
    const result = await run(["bogus-command"]);
    expect(result.code).toBe(2);
    expect(jsonOf(result)).toMatchObject({ ok: false, action: "bogus-command" });
  });

  it("缺少必需参数退出码 2", async () => {
    const result = await run(["player-say", "--game", "g"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--actor");
  });

  it("参数按命令生效：status 不接受 --actor", async () => {
    const result = await run(["status", "--game", "g", "--actor", "a"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option '--actor'");
  });

  it("--slot 只接受 EQUIPMENT_SLOTS", async () => {
    const result = await run([
      "player-equip",
      "--game",
      "g",
      "--actor",
      "a",
      "--item",
      "i",
      "--slot",
      "head",
    ]);
    expect(result.code).toBe(2);
    expect(jsonOf(result)).toMatchObject({ ok: false, action: "player-equip" });
  });

  it("互斥参数在打库之前就被拦下", async () => {
    const use = await run(["player-use", "--game", "g", "--actor", "a", "--item", "i"]);
    expect(use.code).toBe(2);
    expect(jsonOf(use)).toMatchObject({
      ok: false,
      action: "player-use",
      error: "player-use 需要 --target 或 --stage 二选一",
    });

    const create = await run([
      "create",
      "--user",
      "u",
      "--seed",
      "dark-fantasy:bell-monastery",
      "--world",
      "{}",
    ]);
    expect(create.code).toBe(2);
    expect(jsonOf(create).error).toContain("只能四选一");
  });

  it("memory 的三选一与 --owner 的 --name 约束", async () => {
    const both = await run(["memory", "--game", "g", "--actor", "a", "--stage", "s"]);
    expect(both.code).toBe(2);
    expect(jsonOf(both).action).toBe("memory");

    const noName = await run(["memory", "--game", "g", "--owner", "actor"]);
    expect(noName.code).toBe(2);
    expect(jsonOf(noName).error).toContain("--name");
  });

  it("npc 需要 --actor 或 --all", async () => {
    const result = await run(["npc", "--game", "g"]);
    expect(result.code).toBe(2);
    expect(jsonOf(result).error).toContain("--all");
  });

  it("trace 无子命令时默认 list", async () => {
    const result = await run(["trace"]);
    expect(result.code).toBe(0);
    expect(jsonOf(result)).toMatchObject({ ok: true, action: "trace", sub: "list" });
  });

  it("trace schema 不需要数据库", async () => {
    const result = await run(["trace", "schema"]);
    expect(result.code).toBe(0);
    expect(jsonOf(result)).toMatchObject({ ok: true, action: "trace", sub: "schema" });
  });

  it("找不到回合时 ok:false 且退出码 1", async () => {
    const result = await run(["trace", "show", "--turn", "__missing-turn__"]);
    expect(result.code).toBe(1);
    expect(jsonOf(result)).toMatchObject({ ok: false, action: "trace" });
  });
});

/**
 * 作业队列只读 CLI：列表、快照、等待终态。
 *
 * 不启动服务端、不发 HTTP；未来路由接入前，这是观察持久队列的独立入口。
 *   pnpm job list / show <jobId> / watch <jobId>
 */

import { parseArgs } from "node:util";
import { openDatabase } from "../src/db/connect";
import {
  JOB_STATUSES,
  JobFailedError,
  JobNotFoundError,
  type JobStatus,
  JobStore,
  waitForJob,
} from "../src/jobs";

const cliOptions = {
  status: { type: "string", short: "s", multiple: true },
  kind: { type: "string", short: "k" },
  queue: { type: "string", short: "q" },
  limit: { type: "string", short: "l" },
  timeout: { type: "string", short: "t" },
  interval: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type CliValues = {
  status?: string | boolean | string[];
  kind?: string | boolean;
  queue?: string | boolean;
  limit?: string | boolean;
  timeout?: string | boolean;
  interval?: string | boolean;
  json?: string | boolean;
  help?: string | boolean;
};

let outputJson = false;

function fail(message: string): never {
  throw new Error(message);
}

function stringValue(value: string | boolean | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${name} 需要非空字符串`);
  }
  return value.trim();
}

function integerValue(
  value: string | boolean | string[] | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    fail(`${name} 必须是正整数`);
  }
  return Number(value);
}

function parseStatuses(value: string | boolean | string[] | undefined): JobStatus[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value : [value];
  const statuses = raw.flatMap((item) => (typeof item === "string" ? item.split(",") : []));
  if (statuses.length === 0) {
    return undefined;
  }
  const parsed = statuses.map((status) => status.trim()) as JobStatus[];
  for (const status of parsed) {
    if (!JOB_STATUSES.includes(status)) {
      fail(`未知状态: ${status}（可用: ${JOB_STATUSES.join(", ")}）`);
    }
  }
  return parsed;
}

function emit(payload: Record<string, unknown>, humanLines: readonly string[], exitCode = 0): void {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
  if (outputJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  for (const line of humanLines) {
    console.log(line);
  }
}

function usage(): void {
  emit(
    {
      ok: true,
      usage: [
        "pnpm job list [--status pending,running] [--kind <kind>] [--queue <queue>] [--limit 50]",
        "pnpm job show <jobId>",
        "pnpm job watch <jobId> [--timeout 120] [--interval 300]",
      ],
      tip: "加 --json 输出机器可读结果；watch 的状态变化写 stderr。",
    },
    [
      "作业队列 CLI",
      "",
      "用法：",
      "  pnpm job list [options]",
      "  pnpm job show <jobId>",
      "  pnpm job watch <jobId> [options]",
      "",
      "选项：",
      "  -s, --status <s>        状态过滤，可重复或逗号分隔",
      "  -k, --kind <kind>       作业 kind 过滤",
      "  -q, --queue <queue>     队列过滤",
      "  -l, --limit <n>         列表条数，默认 50",
      "  -t, --timeout <seconds> watch 超时，默认 120",
      "      --interval <ms>     watch 轮询间隔，默认 300",
      "      --json              输出 JSON",
    ],
  );
}

async function commandList(store: JobStore, values: CliValues): Promise<void> {
  const statuses = parseStatuses(values.status);
  const jobs = await store.list({
    ...(statuses ? { statuses } : {}),
    ...(stringValue(values.kind, "--kind") ? { kind: stringValue(values.kind, "--kind") } : {}),
    ...(stringValue(values.queue, "--queue")
      ? { queue: stringValue(values.queue, "--queue") }
      : {}),
    ...(integerValue(values.limit, "--limit") !== undefined
      ? { limit: integerValue(values.limit, "--limit") }
      : {}),
  });
  const counts = await store.countByStatus();

  emit({ ok: true, counts, total: jobs.length, jobs }, [
    `作业计数: pending=${counts.pending} running=${counts.running} ` +
      `succeeded=${counts.succeeded} failed=${counts.failed}`,
    ...(jobs.length === 0
      ? ["没有符合条件的作业。"]
      : jobs.map(
          (job) =>
            `${job.jobId}  ${job.status.padEnd(9)}  ${job.kind}  ` +
            `attempts=${job.attempts}/${job.maxAttempts}  ${job.createdAt.toISOString()}`,
        )),
  ]);
}

async function commandShow(store: JobStore, positionals: readonly string[]): Promise<void> {
  const jobId = positionals[1];
  if (!jobId) {
    fail("show 需要 jobId");
  }
  const job = await store.get(jobId);
  if (!job) {
    throw new JobNotFoundError(jobId);
  }
  emit({ ok: true, job }, [
    `jobId: ${job.jobId}`,
    `kind: ${job.kind}`,
    `queue: ${job.queue}`,
    `status: ${job.status}`,
    `attempts: ${job.attempts}/${job.maxAttempts}`,
    `serializationKey: ${job.serializationKey ?? "-"}`,
    `error: ${job.error ?? "-"}`,
    `createdAt: ${job.createdAt.toISOString()}`,
    `startedAt: ${job.startedAt?.toISOString() ?? "-"}`,
    `finishedAt: ${job.finishedAt?.toISOString() ?? "-"}`,
  ]);
}

async function commandWatch(
  store: JobStore,
  positionals: readonly string[],
  values: CliValues,
): Promise<void> {
  const jobId = positionals[1];
  if (!jobId) {
    fail("watch 需要 jobId");
  }
  const timeoutSeconds = integerValue(values.timeout, "--timeout");
  const interval = integerValue(values.interval, "--interval");
  const job = await waitForJob(store, jobId, {
    ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1_000 } : {}),
    ...(interval !== undefined ? { pollIntervalMs: interval } : {}),
    onSnapshot: (snapshot) => {
      if (!outputJson) {
        console.error(`[${snapshot.status}] jobId=${snapshot.jobId} attempts=${snapshot.attempts}`);
      }
    },
  });
  emit({ ok: true, job }, [`作业完成: ${job.jobId} (${job.status})`]);
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: cliOptions,
    allowPositionals: true,
    strict: true,
  });
  const values = parsed.values as CliValues;
  outputJson = values.json === true;
  if (values.help === true) {
    usage();
    return;
  }

  const command = parsed.positionals[0];
  if (command === undefined || command === "help") {
    usage();
    return;
  }

  const handle = openDatabase();
  const store = new JobStore(handle.db);
  try {
    switch (command) {
      case "list":
      case "ls":
        await commandList(store, values);
        return;
      case "show":
        await commandShow(store, parsed.positionals);
        return;
      case "watch":
        await commandWatch(store, parsed.positionals, values);
        return;
      default:
        fail(`未知命令: ${command}；用 pnpm job --help 查看用法`);
    }
  } finally {
    await handle.pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const payload =
    error instanceof JobFailedError
      ? { ok: false, error: message, job: error.snapshot }
      : error instanceof JobNotFoundError
        ? { ok: false, error: message, jobId: error.jobId }
        : { ok: false, error: message };
  if (process.argv.includes("--json")) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    console.error(`❌ ${message}`);
  }
  process.exitCode = 1;
});

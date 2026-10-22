#!/usr/bin/env node
/**
 * 给页面截图（视觉核对用）：起一个 headless Chrome，导航 → 等 → 可选点击 → 截图。
 *
 * 为什么不用 `chrome --headless --screenshot`：命令行截图在 load 事件就落笔，
 * React 首屏还没挂载，拍出来是空白页；它也做不到「先点一下再拍」。
 * 这里走 CDP（DevTools 协议），用 Node 内置的 fetch + WebSocket，不依赖 puppeteer。
 *
 * 默认地址取本机 en0 的局域网 IP + Vite dev 端口（端口来自 @ai-trpg/shared / .env）。
 * 输出默认落到仓库根 `screenshots/`（已 gitignore）。依赖本机 Chrome / Chromium。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WEB_PORT } from "@ai-trpg/shared";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_SIZE = "1280x900";
const DEFAULT_WAIT_MS = 4000;
const DEFAULT_CLICK_WAIT_MS = 2000;

const envFile = readDotEnv(join(repoRoot, ".env"));
const rawPort = process.env.VITE_DEV_PORT ?? envFile.VITE_DEV_PORT;
const webPort = rawPort === undefined || rawPort === "" ? DEFAULT_WEB_PORT : Number(rawPort);

if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  throw new Error(`VITE_DEV_PORT 不是合法端口：${rawPort}`);
}

const defaultBase = `http://${detectLanHost()}:${webPort}`;

/** 找得到就用的浏览器；`CHROME_PATH` 优先。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");

const USAGE = `用真实浏览器给页面截图：导航 → 等待 → （可选）点击 → 截图。

用法：pnpm screenshot [路径] [选项]

  [路径]             页面路径，默认 /
  --base <url>       显式指定地址，默认 ${defaultBase}
  --out <file>       输出文件，默认 screenshots/<路径末段>-<宽>x<高>.png
  --size <宽x高>     视口尺寸，默认 ${DEFAULT_SIZE}
  --click <文本>     截图前点一下这个按钮（按 aria-label 或按钮文字匹配）
                     用 | 分隔可连点多下，如：--click "立即重试|确定"
                     重名时点最后一个（浮层后渲染，也就是看得见的那一层）
  --wait <ms>        导航后等待，默认 ${DEFAULT_WAIT_MS}（等 React 挂载与接口返回）
  --click-wait <ms>  每次点击后等待，默认 ${DEFAULT_CLICK_WAIT_MS}

环境变量：
  CHROME_PATH        指定浏览器可执行文件（默认按常见路径找 Chrome / Chromium）
  VITE_DEV_PORT      覆盖 Vite dev 端口（缺省读根 .env 或共享默认值）`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
  target: string;
  base: string;
  out: string;
  size: string;
  click: string;
  wait: number;
  clickWait: number;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    target: "/",
    base: defaultBase,
    out: "",
    size: DEFAULT_SIZE,
    click: "",
    wait: DEFAULT_WAIT_MS,
    clickWait: DEFAULT_CLICK_WAIT_MS,
    help: false,
  };

  const flags: Record<string, (value: string) => void> = {
    "--base": (value) => {
      options.base = value;
    },
    "--out": (value) => {
      options.out = value;
    },
    "--size": (value) => {
      options.size = value;
    },
    "--click": (value) => {
      options.click = value;
    },
    "--wait": (value) => {
      options.wait = Number(value);
    },
    "--click-wait": (value) => {
      options.clickWait = Number(value);
    },
  };

  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const apply = flags[arg];
    if (apply === undefined) {
      positional.push(arg);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`选项 ${arg} 缺少取值`);
    }
    apply(value);
    index += 1;
  }

  if (positional.length > 1) {
    throw new Error(`多余的参数：${positional.slice(1).join(" ")}`);
  }
  if (positional[0] !== undefined && positional[0] !== "") {
    options.target = positional[0];
  }
  return options;
}

/** 读取根 `.env` 里少数几个键；不引入 dotenv，避免工具脚本再添依赖。 */
function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

/** 优先用 en0 的 IPv4，其次其它非 utun 网卡；都没有才回落到 localhost。 */
function detectLanHost(): string {
  const interfaces = networkInterfaces();
  const en0 = interfaces.en0?.find((address) => address.family === "IPv4" && !address.internal);
  if (en0 !== undefined) {
    return en0.address;
  }
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (name.startsWith("utun")) {
      continue;
    }
    const address = addresses?.find((entry) => entry.family === "IPv4" && !entry.internal);
    if (address !== undefined) {
      return address.address;
    }
  }
  return "localhost";
}

function defaultOut(target: string, size: string): string {
  const slug = target.split("?")[0]?.split("/").filter(Boolean).pop() ?? "index";
  return join(repoRoot, "screenshots", `${slug}-${size}.png`);
}

/** Chrome 把实际调试端口写在这里（用 `--remote-debugging-port=0` 就不必猜端口）。 */
async function readDevToolsPort(profileDir: string, timeoutMs: number): Promise<number> {
  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, "utf8").split("\n");
      if (port !== undefined && port !== "") {
        return Number(port);
      }
    }
    await sleep(150);
  }
  throw new Error("等不到浏览器的调试端口（DevToolsActivePort）");
}

interface PageTarget {
  type: string;
  webSocketDebuggerUrl?: string;
}

async function findPageTarget(
  port: number,
  timeoutMs: number,
): Promise<PageTarget & { webSocketDebuggerUrl: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = (await response.json()) as PageTarget[];
      const page = list.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl !== undefined) {
        return { ...page, webSocketDebuggerUrl: page.webSocketDebuggerUrl };
      }
    } catch {
      // 调试端口刚起来时可能还连不上，重试即可
    }
    await sleep(150);
  }
  throw new Error("找不到可用的浏览器标签页");
}

interface CdpConnection {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

/** 连上 CDP 并返回 `send(method, params)`（Promise 化）。 */
async function connectDevTools(webSocketUrl: string): Promise<CdpConnection> {
  const socket = new WebSocket(webSocketUrl);
  await new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener("open", () => resolvePromise(), { once: true });
    socket.addEventListener("error", () => reject(new Error("连不上浏览器的调试接口")), {
      once: true,
    });
  });

  let nextId = 0;
  const pending = new Map<number, (result: unknown) => void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (typeof message.id !== "number") {
      return;
    }
    const resolvePromise = pending.get(message.id);
    if (resolvePromise === undefined) {
      return;
    }
    pending.delete(message.id);
    resolvePromise(message.result);
  });

  return {
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      nextId += 1;
      const id = nextId;
      return new Promise<T>((resolvePromise) => {
        pending.set(id, (result) => resolvePromise(result as T));
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

/**
 * 点击脚本：找不到就回报名单，省得为了一个文案来回猜。
 * 文字匹配会先去掉 `aria-hidden` 的装饰，再按 aria-label / 可见文字 / 原始文字匹配。
 */
function clickExpression(label: string): string {
  return `(() => {
    const wanted = ${JSON.stringify(label)};
    const visibleText = (button) => {
      const clone = button.cloneNode(true);
      for (const decoration of clone.querySelectorAll('[aria-hidden="true"]')) {
        decoration.remove();
      }
      return clone.textContent.trim();
    };
    const buttons = [...document.querySelectorAll("button")];
    const hit = buttons.findLast(
      (button) =>
        button.getAttribute("aria-label") === wanted ||
        visibleText(button) === wanted ||
        button.textContent.trim() === wanted,
    );
    if (hit !== undefined) {
      hit.click();
      return "ok";
    }
    return buttons
      .map((button) => button.getAttribute("aria-label") ?? visibleText(button))
      .join(" | ");
  })()`;
}

async function evaluate(cdp: CdpConnection, expression: string): Promise<unknown> {
  const { result } = await cdp.send<{ result: { value: unknown } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return result.value;
}

/** Chrome 被 kill 后还可能再写几下，清理失败不能让截图本身变成失败。 */
function removeProfileDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // 临时目录留着也无害，交给系统回收
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (chrome === undefined) {
    throw new Error(
      `找不到 Chrome / Chromium，请用 CHROME_PATH 指定：\n  ${CHROME_CANDIDATES.join("\n  ")}`,
    );
  }

  const [width, height] = options.size.split("x").map(Number);
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`--size 应为「宽x高」，如 1024x768（收到 ${options.size}）`);
  }

  const url = options.target.startsWith("http")
    ? options.target
    : `${options.base.replace(/\/$/, "")}${options.target}`;
  const out =
    options.out === ""
      ? defaultOut(options.target, options.size)
      : isAbsolute(options.out)
        ? options.out
        : resolve(repoRoot, options.out);
  mkdirSync(dirname(out), { recursive: true });

  // 每次都用全新的临时 profile，避免登录态 / 缓存跨次残留。
  const profileDir = mkdtempSync(join(tmpdir(), "ai-trpg-shot-"));
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const port = await readDevToolsPort(profileDir, 15000);
    const page = await findPageTarget(port, 15000);
    const cdp = await connectDevTools(page.webSocketDebuggerUrl);

    try {
      // 用 Emulation 定视口，而不是 --window-size：后者在 headless 下有最小宽度。
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url });
      await sleep(options.wait);

      const mounted = await evaluate(
        cdp,
        "document.getElementById('root')?.childElementCount ?? 0",
      );
      if (mounted === 0) {
        throw new Error(
          `页面没渲染出来（#root 是空的）：${url}\n  确认 dev server 在 ${options.base} 跑着吗？也可能等得不够（--wait / 加大）`,
        );
      }

      for (const label of options.click
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        const clicked = await evaluate(cdp, clickExpression(label));
        if (clicked !== "ok") {
          throw new Error(
            `页面上没有按钮「${label}」。当前按钮：\n  ${String(clicked).split(" | ").join("\n  ")}`,
          );
        }
        await sleep(options.clickWait);
      }

      const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      writeFileSync(out, Buffer.from(shot.data, "base64"));
    } finally {
      cdp.close();
    }
  } finally {
    browser.kill();
    removeProfileDir(profileDir);
  }

  console.log(`已截图：${out}\n  视口 ${width}x${height} · ${url}`);
}

main().catch((error: unknown) => {
  console.error(`截图失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const DIRECT_LINK = /^https:\/\/dl\.fuckingfast\.co\//i;
const POLL_INTERVAL_MS = 700;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromeCandidates() {
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
}

async function findBrowser() {
  for (const candidate of chromeCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("Google Chrome or Microsoft Edge was not found");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => this.onMessage(event));
    socket.addEventListener("close", () => this.failPending(new Error("Browser connection closed")));
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) listener(message);
    }
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch {}
    this.failPending(new Error("Browser connection closed"));
  }
}

async function connectSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to the browser")), { once: true });
  });
  return new CdpClient(socket);
}

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  window.chrome = window.chrome || {
    runtime: {}, loadTimes: () => {}, csi: () => {}, app: { isInstalled: false }
  };
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  if (window.WebGLRenderingContext) {
    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return "Google Inc. (NVIDIA)";
      if (parameter === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce, D3D11)";
      return originalGetParameter.call(this, parameter);
    };
  }
`;

const PAGE_STATE_EXPRESSION = `JSON.stringify((() => {
  const direct = document.querySelector("a[href*='dl.fuckingfast.co']")?.href || "";
  const tokenField = document.querySelector("[name='cf-turnstile-response']");
  const token = typeof window.turnstileToken === "string" && window.turnstileToken
    ? window.turnstileToken
    : tokenField?.value || "";
  const trigger = document.querySelector("[hx-post*='/go']");
  return {
    direct,
    tokenReady: Boolean(token || window.dlCleared),
    triggerReady: Boolean(trigger),
    title: document.title,
    challenge: document.title === "Just a moment..." || Boolean(document.querySelector("#challenge-stage")),
  };
})())`;

class ChromeResolver {
  constructor(profilePath, onStatus) {
    this.profilePath = profilePath;
    this.onStatus = onStatus;
    this.child = null;
    this.cdp = null;
    this.cancelled = false;
  }

  status(value) {
    if (this.onStatus) this.onStatus(value);
  }

  async start(url, timeoutMs) {
    const executable = await findBrowser();
    const port = await findFreePort();
    await fs.mkdir(this.profilePath, { recursive: true });
    this.child = spawn(executable, [
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${this.profilePath}`,
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--window-size=920,760",
      "--app=about:blank",
    ], { stdio: "ignore", windowsHide: false });

    const browserExited = new Promise((_, reject) => {
      this.child.once("exit", () => reject(new Error("Resolver window was closed")));
    });
    const work = this.resolve(url, port, timeoutMs);
    try {
      return await Promise.race([work, browserExited]);
    } finally {
      await this.stop();
    }
  }

  async waitForTarget(port) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !this.cancelled) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        const page = targets.find((item) => item.type === "page");
        if (page?.webSocketDebuggerUrl) return page;
      } catch {}
      await delay(100);
    }
    throw new Error("Chrome did not become ready");
  }

  async resolve(url, port, timeoutMs) {
    const target = await this.waitForTarget(port);
    if (this.cancelled) throw new Error("Skipped by user");
    this.cdp = await connectSocket(target.webSocketDebuggerUrl);
    await this.cdp.send("Network.enable");
    await this.cdp.send("Network.setBlockedURLs", { urls: ["https://dl.fuckingfast.co/*"] });
    await this.cdp.send("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
    await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH_SCRIPT });

    let resolvedDirect = "";
    this.cdp.listeners.add((message) => {
      if (message.method !== "Network.responseReceived") return;
      const response = message.params?.response;
      const headers = response?.headers || {};
      const redirect = headers["hx-redirect"] || headers["HX-Redirect"] || "";
      if (DIRECT_LINK.test(redirect)) resolvedDirect = redirect;
      else if (DIRECT_LINK.test(response?.url || "")) resolvedDirect = response.url;
    });

    await this.cdp.send("Page.navigate", { url });
    this.status("Opening page in Chrome");
    const deadline = Date.now() + timeoutMs;
    let lastClick = 0;
    while (Date.now() < deadline) {
      if (this.cancelled) throw new Error("Skipped by user");
      if (resolvedDirect) return resolvedDirect;
      await delay(POLL_INTERVAL_MS);
      let pageState;
      try {
        const result = await this.cdp.send("Runtime.evaluate", {
          expression: PAGE_STATE_EXPRESSION,
          returnByValue: true,
        });
        pageState = JSON.parse(result.result?.value || "{}");
      } catch {
        continue;
      }
      if (DIRECT_LINK.test(pageState.direct || "")) return pageState.direct;
      if (pageState.challenge) {
        this.status("Waiting for Cloudflare");
        continue;
      }
      if (!pageState.triggerReady) {
        this.status("Waiting for page");
        continue;
      }
      if (!pageState.tokenReady) {
        this.status("Waiting for Cloudflare verification");
        continue;
      }
      this.status("Fetching direct URL");
      if (Date.now() - lastClick >= 1800) {
        lastClick = Date.now();
        await this.cdp.send("Runtime.evaluate", {
          expression: `document.querySelector("[hx-post*='/go']")?.click(); true`,
          returnByValue: true,
          userGesture: true,
        }).catch(() => {});
      }
    }
    throw new Error("Timed out after five minutes");
  }

  async cancel() {
    this.cancelled = true;
    await this.stop();
  }

  async stop() {
    if (this.cdp) {
      await this.cdp.send("Browser.close").catch(() => {});
      this.cdp.close();
      this.cdp = null;
    }
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
      await Promise.race([
        new Promise((resolve) => this.child.once("exit", resolve)),
        delay(3000),
      ]);
    }
    this.child = null;
  }
}

module.exports = ChromeResolver;

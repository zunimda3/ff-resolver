const { app, BrowserWindow, clipboard, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const ChromeResolver = require("./chrome-resolver");

const RESOLVE_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_SOURCE = /^https:\/\/(?:www\.)?fuckingfast\.co\//i;
const DIRECT_LINK = /^https:\/\/dl\.fuckingfast\.co\//i;
const SMOKE_TEST = process.env.FF_RESOLVER_SMOKE === "1";

let mainWindow = null;
let chromeResolver = null;
let activeJob = 0;
let stateFile = "";
let state = createState();

function createState() {
  return {
    pending: [],
    current: null,
    outputs: [],
    failures: [],
    paused: false,
    completed: 0,
  };
}

function publicState() {
  return {
    pending: [...state.pending],
    current: state.current ? { ...state.current } : null,
    outputs: [...state.outputs],
    failures: [...state.failures],
    paused: state.paused,
    completed: state.completed,
  };
}

async function loadState() {
  stateFile = path.join(app.getPath("userData"), "resolver-state.json");
  try {
    const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
    state = { ...createState(), ...saved };
    if (state.current && state.current.url) state.pending.unshift(state.current.url);
    state.current = null;
  } catch {
    state = createState();
  }
  await saveState();
}

async function saveState() {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  broadcastState();
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:update", publicState());
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#f4f7fb",
    title: "FF Resolver",
    show: !SMOKE_TEST,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile("index.html");
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-finish-load", async () => {
    broadcastState();
    if (SMOKE_TEST) {
      const result = await mainWindow.webContents.executeJavaScript(`({
        title: document.title,
        addButton: Boolean(document.getElementById("add")),
        clearQueueButton: Boolean(document.getElementById("clear-queue")),
        outputPanel: Boolean(document.getElementById("output-body"))
      })`);
      if (result.title !== "FF Resolver" || !result.addButton || !result.clearQueueButton || !result.outputPanel) {
        console.error("SMOKE_TEST_FAILED", result);
        app.exit(1);
        return;
      }
      console.log("SMOKE_TEST_PASSED", result);
      setTimeout(() => app.quit(), 100);
    }
  });
}

async function closeResolver() {
  const resolver = chromeResolver;
  chromeResolver = null;
  if (resolver) await resolver.cancel();
}

async function processQueue() {
  if (state.paused || state.current || !state.pending.length) {
    broadcastState();
    return;
  }

  const url = state.pending.shift();
  state.current = {
    url,
    status: "Opening resolver window",
    startedAt: Date.now(),
  };
  await saveState();
  await openResolver(url);
}

async function openResolver(url) {
  await closeResolver();
  const job = ++activeJob;
  const profilePath = path.join(app.getPath("userData"), "chrome-resolver-profile");
  chromeResolver = new ChromeResolver(profilePath, (status) => {
    if (job !== activeJob || !state.current) return;
    state.current.status = status;
    broadcastState();
  });
  try {
    const direct = await chromeResolver.start(url, RESOLVE_TIMEOUT_MS);
    if (job === activeJob && state.current) await completeCurrent(direct, job);
  } catch (error) {
    if (job === activeJob && state.current) await failCurrent(error.message, job);
  }
}

async function completeCurrent(direct, job) {
  if (job !== activeJob || !state.current) return;
  const current = state.current;
  state.outputs.push({ source: current.url, direct, resolvedAt: new Date().toISOString() });
  state.completed += 1;
  state.current = null;
  activeJob += 1;
  await closeResolver();
  await saveState();
  setTimeout(processQueue, 350);
}

async function failCurrent(reason, job) {
  if (job !== activeJob || !state.current) return;
  state.failures.push({ source: state.current.url, error: reason, failedAt: new Date().toISOString() });
  state.current = null;
  activeJob += 1;
  await closeResolver();
  await saveState();
  setTimeout(processQueue, 350);
}

ipcMain.handle("state:get", () => publicState());
ipcMain.handle("queue:add", async (_event, links) => {
  const values = Array.isArray(links) ? links : [];
  const valid = values.map((value) => String(value).trim()).filter((value) => ALLOWED_SOURCE.test(value));
  state.pending.push(...valid);
  await saveState();
  processQueue();
  return { added: valid.length, rejected: values.length - valid.length };
});
ipcMain.handle("queue:pause", async (_event, paused) => {
  state.paused = Boolean(paused);
  await saveState();
  if (!state.paused) processQueue();
  return publicState();
});
ipcMain.handle("queue:skip", async () => {
  if (state.current) await failCurrent("Skipped by user", activeJob);
  return publicState();
});
ipcMain.handle("queue:clear", async () => {
  const cleared = state.pending.length;
  state.pending = [];
  await saveState();
  return cleared;
});
ipcMain.handle("queue:retry-failures", async () => {
  state.pending.push(...state.failures.map((failure) => failure.source));
  state.failures = [];
  await saveState();
  processQueue();
  return publicState();
});
ipcMain.handle("outputs:clear", async () => {
  state.outputs = [];
  state.completed = 0;
  await saveState();
  return publicState();
});
ipcMain.handle("outputs:copy", () => {
  clipboard.writeText(state.outputs.map((item) => item.direct).join("\n"));
  return state.outputs.length;
});
ipcMain.handle("clipboard:copy", (_event, text) => {
  const value = String(text || "");
  if (!DIRECT_LINK.test(value)) return false;
  clipboard.writeText(value);
  return true;
});
ipcMain.handle("outputs:export", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export resolved links",
    defaultPath: "resolved-links.txt",
    filters: [{ name: "Text file", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await fs.writeFile(result.filePath, state.outputs.map((item) => item.direct).join("\n"), "utf8");
  return { saved: true, path: result.filePath };
});

app.whenReady().then(async () => {
  await loadState();
  createMainWindow();
  processQueue();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  activeJob += 1;
  closeResolver();
});

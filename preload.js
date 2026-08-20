const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ffResolver", {
  getState: () => ipcRenderer.invoke("state:get"),
  addLinks: (links) => ipcRenderer.invoke("queue:add", links),
  setPaused: (paused) => ipcRenderer.invoke("queue:pause", Boolean(paused)),
  skipCurrent: () => ipcRenderer.invoke("queue:skip"),
  clearQueue: () => ipcRenderer.invoke("queue:clear"),
  retryFailures: () => ipcRenderer.invoke("queue:retry-failures"),
  clearOutputs: () => ipcRenderer.invoke("outputs:clear"),
  copyOutputs: () => ipcRenderer.invoke("outputs:copy"),
  copyText: (text) => ipcRenderer.invoke("clipboard:copy", text),
  exportOutputs: () => ipcRenderer.invoke("outputs:export"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:update", listener);
    return () => ipcRenderer.removeListener("state:update", listener);
  },
});

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getPrefs: () => ipcRenderer.sendSync("prefs:get"),
  setPrefs: (p) => ipcRenderer.send("prefs:set", p),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (p) => ipcRenderer.invoke("settings:set", p),
  listModels: () => ipcRenderer.invoke("models:list"),
  openFile: () => ipcRenderer.invoke("file:open"),
  readFile: (p) => ipcRenderer.invoke("file:read", p),
  pathForFile: (f) => webUtils.getPathForFile(f),
  stream: (req, onDelta) => {
    const h = (_e, m) => {
      if (m.id === req.id && m.type === "delta") onDelta(m.data);
    };
    ipcRenderer.on("claude:event", h);
    return ipcRenderer
      .invoke("claude:stream", req)
      .finally(() => ipcRenderer.removeListener("claude:event", h));
  },
  cancel: (id) => ipcRenderer.invoke("claude:cancel", id),
});

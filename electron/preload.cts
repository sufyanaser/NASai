import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "./updater.js";

contextBridge.exposeInMainWorld("nasai", {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  runTask: (prompt: string) => ipcRenderer.invoke("task:run", prompt),
  onTaskStatus: (listener: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) =>
      listener(status);
    ipcRenderer.on("task:status", handler);
    return () => ipcRenderer.removeListener("task:status", handler);
  },
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) =>
      listener(status);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
});

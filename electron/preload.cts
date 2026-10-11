import { contextBridge, ipcRenderer } from "electron";
import type {
  ApprovalDecisionInput,
  ProposalEditInput,
  ProposalInput,
} from "./proposals.js";
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
  listTasks: () => ipcRenderer.invoke("task:list"),
  createProposal: (input: ProposalInput) =>
    ipcRenderer.invoke("proposal:create", input),
  decideProposal: (input: ApprovalDecisionInput) =>
    ipcRenderer.invoke("proposal:decide", input),
  editProposal: (actionId: string, edits: ProposalEditInput) =>
    ipcRenderer.invoke("proposal:edit", actionId, edits),
  executeProposal: (actionId: string) =>
    ipcRenderer.invoke("proposal:execute", actionId),
  rollbackLastCheckpoint: () => ipcRenderer.invoke("checkpoint:rollback"),
  cancelCommand: (actionId: string) =>
    ipcRenderer.invoke("command:cancel", actionId),
  runSafeEditFixtureCycle: () => ipcRenderer.invoke("cycle:run-fixture"),
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

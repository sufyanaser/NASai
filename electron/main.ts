import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerUpdater } from "./updater.js";
import {
  inspectWorkspace,
  runEvidenceTask,
  type TaskEvidence,
} from "./workspace.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let selectedWorkspace: string | null = null;

function settingsPath() {
  return join(app.getPath("userData"), "workspace.json");
}

function tasksPath() {
  return join(app.getPath("userData"), "tasks.json");
}

async function restoreWorkspace() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), "utf8")) as {
      path?: string;
    };
    if (saved.path) selectedWorkspace = saved.path;
  } catch {
    selectedWorkspace = null;
  }
}

async function saveTask(task: TaskEvidence) {
  let history: TaskEvidence[] = [];
  try {
    history = JSON.parse(
      await fs.readFile(tasksPath(), "utf8"),
    ) as TaskEvidence[];
  } catch {
    // First run starts with an empty local history.
  }
  await fs.writeFile(
    tasksPath(),
    JSON.stringify([task, ...history].slice(0, 50), null, 2),
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#080b10",
    icon: join(currentDirectory, "../assets/NASai.ico"),
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(join(currentDirectory, "../dist/index.html"));

  return window;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await restoreWorkspace();
  ipcMain.handle("app:get-info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));
  ipcMain.on("window:minimize", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );
  ipcMain.on("window:toggle-maximize", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return;
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
  });
  ipcMain.on("window:close", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
  ipcMain.handle("workspace:get", async () =>
    selectedWorkspace ? inspectWorkspace(selectedWorkspace) : null,
  );
  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a NASai workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    selectedWorkspace = result.filePaths[0];
    await fs.writeFile(
      settingsPath(),
      JSON.stringify({ path: selectedWorkspace }, null, 2),
    );
    return inspectWorkspace(selectedWorkspace);
  });
  ipcMain.handle("task:run", async (event, prompt: string) => {
    if (!selectedWorkspace) throw new Error("Choose a workspace first.");
    event.sender.send("task:status", "thinking");
    const snapshot = await inspectWorkspace(selectedWorkspace);
    event.sender.send("task:status", "working");
    event.sender.send("task:status", "verifying");
    const task = await runEvidenceTask(prompt, snapshot.path);
    await saveTask(task);
    event.sender.send(
      "task:status",
      task.status === "PASS" ? "success" : "attention",
    );
    return task;
  });

  const window = createWindow();
  registerUpdater(window);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      registerUpdater(createWindow());
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerUpdater } from "./updater.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#080b10",
    icon: join(currentDirectory, "../assets/NASai.ico"),
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, "preload.js"),
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("app:get-info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

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

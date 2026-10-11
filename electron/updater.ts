import { app, BrowserWindow, ipcMain } from "electron";
import updater from "electron-updater";

const { autoUpdater } = updater;

export type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "disabled";
  message: string;
  progress?: number;
  version?: string;
};

let registered = false;

export function registerUpdater(window: BrowserWindow): void {
  if (registered) return;
  registered = true;

  const send = (status: UpdateStatus) =>
    window.webContents.send("updater:status", status);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () =>
    send({ state: "checking", message: "Checking for updates…" }),
  );
  autoUpdater.on("update-available", (info) =>
    send({
      state: "available",
      message: `Version ${info.version} is available.`,
      version: info.version,
    }),
  );
  autoUpdater.on("update-not-available", () =>
    send({ state: "not-available", message: "You are up to date." }),
  );
  autoUpdater.on("download-progress", (progress) =>
    send({
      state: "downloading",
      message: "Downloading update…",
      progress: Math.round(progress.percent),
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    send({
      state: "downloaded",
      message: `Version ${info.version} is ready to install.`,
      version: info.version,
    }),
  );
  autoUpdater.on("error", (error) =>
    send({ state: "error", message: error.message }),
  );

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      const status = {
        state: "disabled",
        message: "Update checks run only in installed builds.",
      } satisfies UpdateStatus;
      send(status);
      return status;
    }
    await autoUpdater.checkForUpdates();
    return {
      state: "checking",
      message: "Checking for updates…",
    } satisfies UpdateStatus;
  });

  ipcMain.handle("updater:install", () => {
    if (app.isPackaged) autoUpdater.quitAndInstall(true, true);
  });

  if (app.isPackaged) {
    setTimeout(() => void autoUpdater.checkForUpdates(), 10_000);
  }
}

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rollbackLastAction } from "./checkpoints.js";
import { cancelActiveCommand } from "./commandRunner.js";
import {
  createProposedAction,
  decideProposal,
  editProposedAction,
  type ApprovalDecisionInput,
  type ProposalEditInput,
  type ProposalInput,
  type ProposedAction,
} from "./proposals.js";
import { ProviderRegistry, SecretVault } from "./provider.js";
import { registerUpdater } from "./updater.js";
import {
  executeApprovedAction,
  inspectWorkspace,
  runEvidenceTask,
  runRepresentativeSafeEditCycle,
  type TaskEvidence,
} from "./workspace.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let selectedWorkspace: string | null = null;
const activeProposals = new Map<string, ProposedAction>();

function settingsPath() {
  return join(app.getPath("userData"), "workspace.json");
}

function tasksPath() {
  return join(app.getPath("userData"), "tasks.json");
}

function checkpointsPath() {
  return join(app.getPath("userData"), "checkpoints");
}

async function restoreWorkspace() {
  try {
    const raw = (await fs.readFile(settingsPath(), "utf8")).replace(
      /^\uFEFF/,
      "",
    );
    const saved = JSON.parse(raw) as {
      path?: string;
    };
    if (saved.path) selectedWorkspace = saved.path;
  } catch {
    selectedWorkspace = null;
  }
}

async function readTaskHistory(): Promise<TaskEvidence[]> {
  try {
    const raw = (await fs.readFile(tasksPath(), "utf8")).replace(
      /^\uFEFF/,
      "",
    );
    return JSON.parse(raw) as TaskEvidence[];
  } catch {
    return [];
  }
}

async function saveTask(task: TaskEvidence) {
  const history = (await readTaskHistory()).filter(
    (entry) => entry.id !== task.id,
  );
  for (const proposal of task.proposals ?? []) {
    activeProposals.set(proposal.id, proposal);
  }
  await fs.writeFile(
    tasksPath(),
    JSON.stringify([task, ...history].slice(0, 50), null, 2),
  );
}

async function syncProposalToLatestTask(
  updated: ProposedAction,
): Promise<TaskEvidence | null> {
  activeProposals.set(updated.id, updated);
  const history = await readTaskHistory();
  if (history.length === 0) return null;
  const latest = history[0];
  const proposals = latest.proposals ?? [];
  const exists = proposals.some((p) => p.id === updated.id);
  latest.proposals = exists
    ? proposals.map((p) => (p.id === updated.id ? updated : p))
    : [...proposals, updated];
  await fs.writeFile(
    tasksPath(),
    JSON.stringify(history.slice(0, 50), null, 2),
  );
  return latest;
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
  ipcMain.handle("task:list", async () => readTaskHistory());
  ipcMain.handle("task:run", async (event, prompt: string) => {
    if (!selectedWorkspace) throw new Error("Choose a workspace first.");
    event.sender.send("task:status", "thinking");
    const snapshot = await inspectWorkspace(selectedWorkspace);
    event.sender.send("task:status", "working");
    event.sender.send("task:status", "verifying");
    const task = await runEvidenceTask(prompt, snapshot.path);
    await saveTask(task);
    const waitingForApproval = (task.proposals ?? []).some(
      (p) => p.requiresApproval && p.status === "pending_approval",
    );
    event.sender.send(
      "task:status",
      waitingForApproval
        ? "attention"
        : task.status === "PASS"
          ? "success"
          : "attention",
    );
    return task;
  });
  ipcMain.handle(
    "proposal:create",
    async (event, input: ProposalInput): Promise<ProposedAction> => {
      if (!selectedWorkspace) throw new Error("Choose a workspace first.");
      const proposal = await createProposedAction(selectedWorkspace, input);
      await syncProposalToLatestTask(proposal);
      if (proposal.requiresApproval) {
        event.sender.send("task:status", "attention");
      }
      return proposal;
    },
  );
  ipcMain.handle(
    "proposal:decide",
    async (event, input: ApprovalDecisionInput): Promise<ProposedAction> => {
      const existing = activeProposals.get(input.actionId);
      if (!existing) {
        throw new Error(`Proposal "${input.actionId}" was not found.`);
      }
      const decided = decideProposal(existing, input);
      await syncProposalToLatestTask(decided);
      const stillPending = Array.from(activeProposals.values()).some(
        (p) => p.requiresApproval && p.status === "pending_approval",
      );
      event.sender.send(
        "task:status",
        stillPending
          ? "attention"
          : decided.status === "approved"
            ? "success"
            : "idle",
      );
      return decided;
    },
  );
  ipcMain.handle(
    "proposal:edit",
    async (
      event,
      actionId: string,
      edits: ProposalEditInput,
    ): Promise<ProposedAction> => {
      const existing = activeProposals.get(actionId);
      if (!existing) {
        throw new Error(`Proposal "${actionId}" was not found.`);
      }
      const updated = await editProposedAction(existing, edits);
      await syncProposalToLatestTask(updated);
      event.sender.send("task:status", "attention");
      return updated;
    },
  );
  ipcMain.handle(
    "proposal:execute",
    async (event, actionId: string): Promise<TaskEvidence> => {
      const existing = activeProposals.get(actionId);
      if (!existing) {
        throw new Error(`Proposal "${actionId}" was not found.`);
      }
      event.sender.send("task:status", "working");
      const { action, checkpoint, commandResult } = await executeApprovedAction(
        existing,
        checkpointsPath(),
      );
      activeProposals.set(action.id, action);

      const history = await readTaskHistory();
      if (history.length === 0) {
        throw new Error("No active task record found.");
      }
      const latest = history[0];
      latest.proposals = (latest.proposals ?? []).map((p) =>
        p.id === action.id ? action : p,
      );
      if (commandResult) {
        latest.commands = [...(latest.commands ?? []), commandResult];
      }
      if (checkpoint) {
        latest.checkpoints = [checkpoint, ...(latest.checkpoints ?? [])];
        latest.modifiedFiles = [
          {
            relativePath: checkpoint.relativePath,
            kind: checkpoint.kind,
            beforeHash: checkpoint.beforeHash,
            afterHash: checkpoint.afterHash,
            checkpointId: checkpoint.id,
            rolledBack: false,
          },
          ...(latest.modifiedFiles ?? []),
        ];
      }
      latest.stages = [
        ...(latest.stages ?? []),
        {
          id: `exec-${action.id}`,
          label: `Execute ${action.kind}`,
          state: action.evidence?.state ?? "NOT VERIFIED",
          detail: action.evidence?.summary ?? action.target,
          timestamp: new Date().toISOString(),
        },
      ];
      await fs.writeFile(
        tasksPath(),
        JSON.stringify(history.slice(0, 50), null, 2),
      );
      event.sender.send(
        "task:status",
        action.evidence?.state === "PASS" ? "success" : "attention",
      );
      return latest;
    },
  );
  ipcMain.handle("checkpoint:rollback", async (event): Promise<TaskEvidence> => {
    const { checkpoint, verified, detail } = await rollbackLastAction(
      checkpointsPath(),
      selectedWorkspace ?? undefined,
    );
    const history = await readTaskHistory();
    if (history.length === 0) {
      throw new Error("No task history available to update rollback evidence.");
    }
    const latest = history[0];
    latest.checkpoints = (latest.checkpoints ?? []).map((chk) =>
      chk.id === checkpoint.id ? checkpoint : chk,
    );
    latest.modifiedFiles = (latest.modifiedFiles ?? []).map((file) =>
      file.checkpointId === checkpoint.id
        ? { ...file, rolledBack: verified }
        : file,
    );
    latest.proposals = (latest.proposals ?? []).map((p) =>
      p.id === checkpoint.actionId ? { ...p, status: "rolled_back" } : p,
    );
    latest.stages = [
      ...(latest.stages ?? []),
      {
        id: `rollback-${checkpoint.id}`,
        label: `Rollback ${checkpoint.relativePath}`,
        state: verified ? "PASS" : "FAIL",
        detail,
        timestamp: new Date().toISOString(),
      },
    ];
    await fs.writeFile(
      tasksPath(),
      JSON.stringify(history.slice(0, 50), null, 2),
    );
    event.sender.send("task:status", verified ? "success" : "attention");
    return latest;
  });
  ipcMain.handle("command:cancel", (_event, actionId: string) =>
    cancelActiveCommand(actionId),
  );
  const vault = new SecretVault({
    userDataDir: app.getPath("userData"),
    safeStorage,
  });
  const providerRegistry = new ProviderRegistry(vault);

  ipcMain.handle("provider:get-status", async () =>
    providerRegistry.getStatus(),
  );
  ipcMain.handle("provider:set-key", async (_event, apiKey: string) => {
    await vault.setApiKey(apiKey);
    return providerRegistry.getStatus();
  });
  ipcMain.handle("provider:clear-key", async () => {
    await vault.clearApiKey();
    return providerRegistry.getStatus();
  });

  ipcMain.handle("cycle:run-fixture", async (event): Promise<TaskEvidence> => {
    event.sender.send("task:status", "working");
    const report = await runRepresentativeSafeEditCycle();
    await saveTask(report.taskEvidence);
    event.sender.send(
      "task:status",
      report.taskEvidence.status === "PASS" ? "success" : "attention",
    );
    return report.taskEvidence;
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

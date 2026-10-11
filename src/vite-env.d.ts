/// <reference types="vite/client" />

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "disabled";

interface UpdateStatus {
  state: UpdateState;
  message: string;
  progress?: number;
  version?: string;
}

interface WorkspaceSnapshot {
  path: string;
  name: string;
  branch: string | null;
  gitAvailable: boolean;
  dirty: boolean | null;
  fileCount: number;
  rules: string[];
  inspectedAt: string;
}

interface TaskEvidence {
  id: string;
  prompt: string;
  workspace: string;
  startedAt: string;
  completedAt: string;
  status: "PASS" | "FAIL" | "NOT VERIFIED";
  summary: string;
  checks: Array<{
    label: string;
    state: "PASS" | "FAIL" | "NOT VERIFIED";
    detail: string;
  }>;
}

interface Window {
  nasai?: {
    getAppInfo: () => Promise<{
      version: string;
      platform: string;
      packaged: boolean;
    }>;
    checkForUpdates: () => Promise<UpdateStatus>;
    installUpdate: () => Promise<void>;
    minimizeWindow: () => void;
    toggleMaximizeWindow: () => void;
    closeWindow: () => void;
    getWorkspace: () => Promise<WorkspaceSnapshot | null>;
    selectWorkspace: () => Promise<WorkspaceSnapshot | null>;
    runTask: (prompt: string) => Promise<TaskEvidence>;
    onTaskStatus: (
      listener: (
        status:
          | "idle"
          | "thinking"
          | "working"
          | "verifying"
          | "success"
          | "attention",
      ) => void,
    ) => () => void;
    onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
  };
}

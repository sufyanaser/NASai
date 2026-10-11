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

type GateState = "PASS" | "FAIL" | "NOT VERIFIED";

type ActionKind =
  | "read_file"
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "git_operation";

type RiskLevel = "low" | "medium" | "high" | "critical";

type ActionStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "rolled_back";

interface CommandSpec {
  executable: string;
  args: string[];
}

interface ActionEvidence {
  state: GateState;
  summary: string;
  detail: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  recordedAt: string;
}

interface RecoveryPlan {
  strategy: "none" | "file_checkpoint" | "git_inspect_only";
  checkpointId: string | null;
  restorable: boolean;
  description: string;
}

interface ProposedAction {
  id: string;
  kind: ActionKind;
  description: string;
  reason: string;
  target: string;
  workspacePath: string;
  relativePath?: string;
  proposedContent?: string;
  command?: CommandSpec;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  sensitiveReason: string | null;
  preview: string;
  status: ActionStatus;
  evidence: ActionEvidence | null;
  recovery: RecoveryPlan;
  createdAt: string;
  updatedAt: string;
}

interface ProposalInput {
  id?: string;
  kind: ActionKind;
  description: string;
  reason: string;
  targetPath?: string;
  proposedContent?: string;
  command?: CommandSpec;
}

interface ApprovalDecisionInput {
  actionId: string;
  decision: "approve" | "reject";
  scope?: "single_action" | "blanket" | "session";
}

interface ProposalEditInput {
  description?: string;
  reason?: string;
  proposedContent?: string;
  commandArgs?: string[];
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

interface GitStatusSnapshot {
  gitAvailable: boolean;
  branch: string | null;
  dirty: boolean | null;
  porcelainLines: string[];
  capturedAt: string;
}

interface FileCheckpoint {
  id: string;
  actionId: string;
  kind: "create_file" | "edit_file" | "delete_file";
  workspacePath: string;
  relativePath: string;
  targetFilePath: string;
  existedBefore: boolean;
  beforeHash: string | null;
  afterHash: string | null;
  backupFilePath: string | null;
  gitBefore: GitStatusSnapshot;
  createdAt: string;
  rolledBackAt: string | null;
  rollbackVerification: GateState;
  rollbackDetail: string | null;
}

interface CommandRunResult {
  actionId: string;
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  state: GateState;
  summary: string;
}

interface TaskStageRecord {
  id: string;
  label: string;
  state: GateState;
  detail: string;
  timestamp: string;
}

interface ModifiedFileRecord {
  relativePath: string;
  kind: "create_file" | "edit_file" | "delete_file";
  beforeHash: string | null;
  afterHash: string | null;
  checkpointId: string | null;
  rolledBack: boolean;
}

interface TaskEvidence {
  id: string;
  prompt: string;
  workspace: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  status: GateState;
  summary: string;
  checks: Array<{
    label: string;
    state: GateState;
    detail: string;
  }>;
  stages?: TaskStageRecord[];
  proposals?: ProposedAction[];
  commands?: CommandRunResult[];
  modifiedFiles?: ModifiedFileRecord[];
  checkpoints?: FileCheckpoint[];
  gitState?: GitStatusSnapshot;
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
    listTasks?: () => Promise<TaskEvidence[]>;
    createProposal?: (input: ProposalInput) => Promise<ProposedAction>;
    decideProposal?: (input: ApprovalDecisionInput) => Promise<ProposedAction>;
    editProposal?: (
      actionId: string,
      edits: ProposalEditInput,
    ) => Promise<ProposedAction>;
    executeProposal?: (actionId: string) => Promise<TaskEvidence>;
    rollbackLastCheckpoint?: () => Promise<TaskEvidence>;
    cancelCommand?: (actionId: string) => Promise<boolean>;
    runSafeEditFixtureCycle?: () => Promise<TaskEvidence>;
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

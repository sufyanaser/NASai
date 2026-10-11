import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  captureGitStatusSnapshot,
  executeApprovedFileAction,
  rollbackLastAction,
  type FileCheckpoint,
  type GitStatusSnapshot,
} from "./checkpoints.js";
import {
  executeApprovedCommand,
  type CommandExecutionOptions,
  type CommandRunResult,
} from "./commandRunner.js";
import {
  createProposedAction,
  decideProposal,
  hashContent,
  proposeActionsForTask,
  type ProposedAction,
} from "./proposals.js";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  "coverage",
]);

export type GateState = "PASS" | "FAIL" | "NOT VERIFIED";

export interface WorkspaceSnapshot {
  path: string;
  name: string;
  branch: string | null;
  gitAvailable: boolean;
  dirty: boolean | null;
  fileCount: number;
  rules: string[];
  inspectedAt: string;
}

export interface TaskStageRecord {
  id: string;
  label: string;
  state: GateState;
  detail: string;
  timestamp: string;
}

export interface ModifiedFileRecord {
  relativePath: string;
  kind: "create_file" | "edit_file" | "delete_file";
  beforeHash: string | null;
  afterHash: string | null;
  checkpointId: string | null;
  rolledBack: boolean;
}

export interface TaskEvidence {
  id: string;
  prompt: string;
  workspace: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  status: GateState;
  summary: string;
  checks: Array<{ label: string; state: GateState; detail: string }>;
  stages?: TaskStageRecord[];
  proposals?: ProposedAction[];
  commands?: CommandRunResult[];
  modifiedFiles?: ModifiedFileRecord[];
  checkpoints?: FileCheckpoint[];
  gitState?: GitStatusSnapshot;
}

export interface SafeEditCycleReport {
  workspaceSnapshot: WorkspaceSnapshot;
  editProposal: ProposedAction;
  verifyCommandProposal: ProposedAction;
  diffPreview: string;
  unapprovedBlocked: boolean;
  checkpoint: FileCheckpoint;
  executedEdit: ProposedAction;
  verificationCommandResult: CommandRunResult;
  rollbackResult: {
    checkpoint: FileCheckpoint;
    verified: boolean;
    detail: string;
  };
  userChangesPreserved: boolean;
  taskEvidence: TaskEvidence;
}

async function countFiles(root: string, limit = 5_000): Promise<number> {
  let count = 0;
  const pending = [root];

  while (pending.length > 0 && count < limit) {
    const directory = pending.pop();
    if (!directory) break;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      // Locked and permission-restricted folders are skipped, not fatal.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          !ignoredDirectories.has(entry.name) &&
          !entry.name.startsWith("release-")
        )
          pending.push(join(directory, entry.name));
      } else {
        count += 1;
        if (count >= limit) break;
      }
    }
  }

  return count;
}

async function findRules(root: string): Promise<string[]> {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    join("docs", "knowledge", "OPERATING-CHARTER.md"),
    join("docs", "knowledge", "FORBIDDEN-ASSUMPTIONS.md"),
  ];
  const found: string[] = [];
  for (const candidate of candidates) {
    try {
      const details = await fs.stat(join(root, candidate));
      if (details.isFile()) found.push(candidate.replaceAll("\\", "/"));
    } catch {
      // A missing optional rule is evidence, not an exceptional condition.
    }
  }
  return found;
}

async function inspectGit(root: string) {
  try {
    const [{ stdout: branch }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd: root }),
      execFileAsync("git", ["status", "--porcelain"], { cwd: root }),
    ]);
    return {
      gitAvailable: true,
      branch: branch.trim() || null,
      dirty: status.trim().length > 0,
    };
  } catch {
    return { gitAvailable: false, branch: null, dirty: null };
  }
}

export async function inspectWorkspace(
  workspacePath: string,
): Promise<WorkspaceSnapshot> {
  const details = await fs.stat(workspacePath);
  if (!details.isDirectory()) throw new Error("Workspace must be a directory.");

  const [fileCount, rules, git] = await Promise.all([
    countFiles(workspacePath),
    findRules(workspacePath),
    inspectGit(workspacePath),
  ]);

  return {
    path: workspacePath,
    name: basename(workspacePath),
    fileCount,
    rules,
    ...git,
    inspectedAt: new Date().toISOString(),
  };
}

export async function executeApprovedAction(
  proposal: ProposedAction,
  checkpointStoreDir: string,
  commandOptions?: CommandExecutionOptions,
): Promise<{
  action: ProposedAction;
  checkpoint: FileCheckpoint | null;
  commandResult: CommandRunResult | null;
}> {
  if (proposal.kind === "run_command" || proposal.kind === "git_operation") {
    const { action, result } = await executeApprovedCommand(
      proposal,
      commandOptions,
    );
    return { action, checkpoint: null, commandResult: result };
  }
  const { action, checkpoint } = await executeApprovedFileAction(
    proposal,
    checkpointStoreDir,
  );
  return { action, checkpoint, commandResult: null };
}

export async function runEvidenceTask(
  prompt: string,
  workspacePath: string,
): Promise<TaskEvidence> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error("Task description is required.");
  const startTimeMs = Date.now();
  const startedAt = new Date(startTimeMs).toISOString();
  const [snapshot, gitState] = await Promise.all([
    inspectWorkspace(workspacePath),
    captureGitStatusSnapshot(workspacePath),
  ]);
  const checks: TaskEvidence["checks"] = [
    {
      label: "Workspace scope",
      state: "PASS",
      detail: snapshot.path,
    },
    {
      label: "Project rules",
      state: snapshot.rules.length > 0 ? "PASS" : "NOT VERIFIED",
      detail:
        snapshot.rules.length > 0
          ? `${snapshot.rules.length} rule files loaded`
          : "No supported project rule files found",
    },
    {
      label: "Git state",
      state: snapshot.gitAvailable ? "PASS" : "NOT VERIFIED",
      detail: snapshot.gitAvailable
        ? `${snapshot.branch ?? "detached HEAD"} · ${snapshot.dirty ? "changes present" : "clean"}`
        : "Git repository not detected",
    },
  ];
  const failed = checks.some((check) => check.state === "FAIL");
  const incomplete = checks.some((check) => check.state === "NOT VERIFIED");
  const proposals = await proposeActionsForTask(
    snapshot.path,
    normalizedPrompt,
    snapshot.rules,
    snapshot.gitAvailable,
  );
  const completedAt = new Date().toISOString();
  const stages: TaskStageRecord[] = [
    {
      id: "discover",
      label: "Discover workspace",
      state: "PASS",
      detail: `Inspected ${snapshot.fileCount} files in ${snapshot.name}`,
      timestamp: startedAt,
    },
    {
      id: "rules",
      label: "Load project rules",
      state: snapshot.rules.length > 0 ? "PASS" : "NOT VERIFIED",
      detail:
        snapshot.rules.length > 0
          ? snapshot.rules.join(", ")
          : "No supported project rule files found",
      timestamp: completedAt,
    },
    {
      id: "propose",
      label: "Generate proposals",
      state: proposals.length > 0 ? "PASS" : "NOT VERIFIED",
      detail: `${proposals.length} proposed action(s) prepared without modifying files`,
      timestamp: completedAt,
    },
  ];

  return {
    id: randomUUID(),
    prompt: normalizedPrompt,
    workspace: snapshot.path,
    startedAt,
    completedAt,
    durationMs: Date.now() - startTimeMs,
    status: failed ? "FAIL" : incomplete ? "NOT VERIFIED" : "PASS",
    summary: `Inspected ${snapshot.fileCount} files and captured ${checks.length} evidence checks. No workspace files were changed.`,
    checks,
    stages,
    proposals,
    commands: [],
    modifiedFiles: [],
    checkpoints: [],
    gitState,
  };
}

export async function runRepresentativeSafeEditCycle(
  customFixtureRoot?: string,
  customCheckpointStore?: string,
): Promise<SafeEditCycleReport> {
  const createdTempFixture = !customFixtureRoot;
  const createdTempStore = !customCheckpointStore;
  const fixtureWorkspace =
    customFixtureRoot ??
    (await fs.mkdtemp(join(tmpdir(), "nasai-stage5-fixture-")));
  const checkpointStore =
    customCheckpointStore ??
    (await fs.mkdtemp(join(tmpdir(), "nasai-stage5-checkpoints-")));

  try {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();

    await execFileAsync("git", ["init"], { cwd: fixtureWorkspace });
    await execFileAsync("git", ["config", "user.email", "verify@nasai.local"], {
      cwd: fixtureWorkspace,
    });
    await execFileAsync("git", ["config", "user.name", "NASai Verifier"], {
      cwd: fixtureWorkspace,
    });

    await fs.mkdir(join(fixtureWorkspace, "src"), { recursive: true });
    await fs.writeFile(
      join(fixtureWorkspace, "AGENTS.md"),
      "# AGENTS.md\nVerify every claim with inspectable evidence.\n",
      "utf8",
    );

    const mathFile = join(fixtureWorkspace, "src", "math.mjs");
    const originalMathContent =
      "export function add(a, b) {\n  return a - b;\n}\n";
    const fixedMathContent =
      "export function add(a, b) {\n  return a + b;\n}\n";
    await fs.writeFile(mathFile, originalMathContent, "utf8");

    const verifyScript = join(fixtureWorkspace, "verify.mjs");
    await fs.writeFile(
      verifyScript,
      [
        'import { add } from "./src/math.mjs";',
        "if (add(2, 3) !== 5) {",
        '  console.error("FAIL: expected 5, got", add(2, 3));',
        "  process.exit(1);",
        "}",
        'console.log("VERIFY_MATH_PASS: add(2,3)===5");',
      ].join("\n") + "\n",
      "utf8",
    );

    const userWorkFile = join(fixtureWorkspace, "src", "user-uncommitted.ts");
    await fs.writeFile(
      userWorkFile,
      'export const committedNote = "initial";\n',
      "utf8",
    );

    await execFileAsync("git", ["add", "."], { cwd: fixtureWorkspace });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], {
      cwd: fixtureWorkspace,
    });

    // Uncommitted user work that must remain untouched across edit, verify, and rollback
    const userUncommittedContent =
      'export const userDraft = "do-not-touch-this-change";\n';
    await fs.writeFile(userWorkFile, userUncommittedContent, "utf8");
    const userOriginalHash = hashContent(userUncommittedContent);

    // 1. Discover Workspace
    const workspaceSnapshot = await inspectWorkspace(fixtureWorkspace);

    // 2. Create proposal
    const editProposal = await createProposedAction(fixtureWorkspace, {
      kind: "edit_file",
      description: "Fix addition operator in src/math.mjs",
      reason: "add(2, 3) returned -1 instead of 5",
      targetPath: "src/math.mjs",
      proposedContent: fixedMathContent,
    });

    // 3. Show diff
    const diffPreview = editProposal.preview;

    // 4. Request approval (verify unapproved write is blocked first)
    let unapprovedBlocked = false;
    try {
      await executeApprovedAction(editProposal, checkpointStore);
    } catch {
      unapprovedBlocked = true;
    }

    const approvedEdit = decideProposal(editProposal, {
      actionId: editProposal.id,
      decision: "approve",
      scope: "single_action",
    });

    // 5. Create checkpoint & 6. Execute edit
    const { action: executedEdit, checkpoint } = await executeApprovedAction(
      approvedEdit,
      checkpointStore,
    );
    if (!checkpoint) {
      throw new Error("Expected file checkpoint to be created before write.");
    }

    // 7. Run verification gate via Safe Command Runner
    const verifyCommandProposal = await createProposedAction(fixtureWorkspace, {
      kind: "run_command",
      description: "Run verify.mjs acceptance gate",
      reason: "Confirm add(2, 3) === 5 after applying fix",
      command: { executable: "node", args: ["verify.mjs"] },
    });
    const approvedVerifyCmd = decideProposal(verifyCommandProposal, {
      actionId: verifyCommandProposal.id,
      decision: "approve",
      scope: "single_action",
    });
    const { action: executedVerifyCmd, commandResult } =
      await executeApprovedAction(approvedVerifyCmd, checkpointStore, {
        expectedExitCode: 0,
        expectedOutputIncludes: "VERIFY_MATH_PASS",
      });
    if (!commandResult) {
      throw new Error("Expected command result from verification gate.");
    }

    // 9. Test rollback
    const rollbackResult = await rollbackLastAction(
      checkpointStore,
      fixtureWorkspace,
    );

    // 10. Confirm user's original uncommitted changes remained untouched
    const userPostCycleContent = await fs.readFile(userWorkFile, "utf8");
    const restoredMathContent = await fs.readFile(mathFile, "utf8");
    const userChangesPreserved =
      hashContent(userPostCycleContent) === userOriginalHash &&
      restoredMathContent === originalMathContent;

    const gitStateAfter = await captureGitStatusSnapshot(fixtureWorkspace);
    const completedAt = new Date().toISOString();

    // 8. Construct full inspectable TaskEvidence
    const stages: TaskStageRecord[] = [
      {
        id: "discover",
        label: "1. Discover workspace",
        state: "PASS",
        detail: `${workspaceSnapshot.name} · ${workspaceSnapshot.fileCount} files · rules: ${workspaceSnapshot.rules.join(", ")}`,
        timestamp: startedAt,
      },
      {
        id: "propose",
        label: "2 & 3. Propose action & diff",
        state: diffPreview.includes("+  return a + b;") ? "PASS" : "FAIL",
        detail: `Generated unified diff for ${editProposal.target}`,
        timestamp: startedAt,
      },
      {
        id: "approval",
        label: "4. Single-action approval gate",
        state: unapprovedBlocked ? "PASS" : "FAIL",
        detail:
          "Blocked unapproved write; approved single action explicitly",
        timestamp: startedAt,
      },
      {
        id: "checkpoint",
        label: "5 & 6. Checkpoint & execute write",
        state: executedEdit.evidence?.state ?? "FAIL",
        detail: `Checkpoint ${checkpoint.id} (${checkpoint.beforeHash?.slice(0, 12)} → ${checkpoint.afterHash?.slice(0, 12)})`,
        timestamp: checkpoint.createdAt,
      },
      {
        id: "verify-gate",
        label: "7 & 8. Verification gate & evidence",
        state: commandResult.state,
        detail: commandResult.summary,
        timestamp: completedAt,
      },
      {
        id: "rollback",
        label: "9 & 10. Rollback & user-change preservation",
        state:
          rollbackResult.verified && userChangesPreserved ? "PASS" : "FAIL",
        detail: `${rollbackResult.detail} · Unrelated user changes preserved: ${userChangesPreserved}`,
        timestamp: completedAt,
      },
    ];

    const checks: TaskEvidence["checks"] = stages.map((stage) => ({
      label: stage.label,
      state: stage.state,
      detail: stage.detail,
    }));

    const allPassed = checks.every((c) => c.state === "PASS");

    const taskEvidence: TaskEvidence = {
      id: randomUUID(),
      prompt: "Run representative safe edit, verification gate, and rollback cycle",
      workspace: fixtureWorkspace,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
      status: allPassed ? "PASS" : "FAIL",
      summary:
        "Completed 10-step safe edit, verification gate, and rollback cycle in isolated fixture.",
      checks,
      stages,
      proposals: [
        { ...executedEdit, status: "rolled_back" },
        executedVerifyCmd,
      ],
      commands: [commandResult],
      modifiedFiles: [
        {
          relativePath: checkpoint.relativePath,
          kind: checkpoint.kind,
          beforeHash: checkpoint.beforeHash,
          afterHash: checkpoint.afterHash,
          checkpointId: checkpoint.id,
          rolledBack: rollbackResult.verified,
        },
      ],
      checkpoints: [rollbackResult.checkpoint],
      gitState: gitStateAfter,
    };

    return {
      workspaceSnapshot,
      editProposal,
      verifyCommandProposal,
      diffPreview,
      unapprovedBlocked,
      checkpoint: rollbackResult.checkpoint,
      executedEdit,
      verificationCommandResult: commandResult,
      rollbackResult,
      userChangesPreserved,
      taskEvidence,
    };
  } finally {
    if (createdTempFixture && fixtureWorkspace.startsWith(tmpdir())) {
      await fs.rm(fixtureWorkspace, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
    if (createdTempStore && checkpointStore.startsWith(tmpdir())) {
      await fs.rm(checkpointStore, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
}

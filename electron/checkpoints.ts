import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  hashContent,
  resolveWorkspaceTarget,
  type ProposedAction,
} from "./proposals.js";
import type { GateState } from "./workspace.js";

const execFileAsync = promisify(execFile);

export interface GitStatusSnapshot {
  gitAvailable: boolean;
  branch: string | null;
  dirty: boolean | null;
  porcelainLines: string[];
  capturedAt: string;
}

export interface FileCheckpoint {
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

export async function captureGitStatusSnapshot(
  workspacePath: string,
): Promise<GitStatusSnapshot> {
  const capturedAt = new Date().toISOString();
  try {
    const [{ stdout: branchOut }, { stdout: statusOut }] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd: workspacePath }),
      execFileAsync("git", ["status", "--porcelain"], { cwd: workspacePath }),
    ]);
    const porcelainLines = statusOut
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    return {
      gitAvailable: true,
      branch: branchOut.trim() || null,
      dirty: porcelainLines.length > 0,
      porcelainLines,
      capturedAt,
    };
  } catch {
    return {
      gitAvailable: false,
      branch: null,
      dirty: null,
      porcelainLines: [],
      capturedAt,
    };
  }
}

function indexFilePath(checkpointStoreDir: string): string {
  return join(checkpointStoreDir, "index.json");
}

function metadataFilePath(
  checkpointStoreDir: string,
  checkpointId: string,
): string {
  return join(checkpointStoreDir, `${checkpointId}.json`);
}

export async function listCheckpoints(
  checkpointStoreDir: string,
  workspacePath?: string,
): Promise<FileCheckpoint[]> {
  try {
    const raw = await fs.readFile(indexFilePath(checkpointStoreDir), "utf8");
    const items = JSON.parse(raw) as FileCheckpoint[];
    if (!workspacePath) return items;
    const normalizedRoot = resolve(workspacePath);
    return items.filter(
      (item) => resolve(item.workspacePath) === normalizedRoot,
    );
  } catch {
    return [];
  }
}

async function saveCheckpointRecord(
  checkpointStoreDir: string,
  checkpoint: FileCheckpoint,
): Promise<void> {
  await fs.mkdir(checkpointStoreDir, { recursive: true });
  await fs.writeFile(
    metadataFilePath(checkpointStoreDir, checkpoint.id),
    JSON.stringify(checkpoint, null, 2),
    "utf8",
  );
  const existing = (await listCheckpoints(checkpointStoreDir)).filter(
    (item) => item.id !== checkpoint.id,
  );
  await fs.writeFile(
    indexFilePath(checkpointStoreDir),
    JSON.stringify([checkpoint, ...existing].slice(0, 100), null, 2),
    "utf8",
  );
}

export async function executeApprovedFileAction(
  proposal: ProposedAction,
  checkpointStoreDir: string,
): Promise<{ action: ProposedAction; checkpoint: FileCheckpoint | null }> {
  const startedAt = Date.now();
  const targetInput = proposal.relativePath ?? proposal.target;
  const { absolutePath, relativePath } = resolveWorkspaceTarget(
    proposal.workspacePath,
    targetInput,
  );

  if (proposal.kind === "read_file") {
    const content = await fs.readFile(absolutePath, "utf8");
    const fileHash = hashContent(content);
    const now = new Date().toISOString();
    const updated: ProposedAction = {
      ...proposal,
      status: "executed",
      updatedAt: now,
      evidence: {
        state: "PASS",
        summary: `Read ${relativePath} (${content.length} chars, SHA-256 ${fileHash.slice(0, 12)}).`,
        detail: `Verified read-only inspection of ${relativePath}.`,
        beforeHash: fileHash,
        afterHash: fileHash,
        durationMs: Date.now() - startedAt,
        recordedAt: now,
      },
    };
    return { action: updated, checkpoint: null };
  }

  if (
    proposal.kind !== "create_file" &&
    proposal.kind !== "edit_file" &&
    proposal.kind !== "delete_file"
  ) {
    throw new Error(
      `Action kind "${proposal.kind}" is not a file action.`,
    );
  }

  if (proposal.status !== "approved") {
    throw new Error(
      `Cannot execute ${proposal.kind} on "${relativePath}" without explicit single-action approval (current status: ${proposal.status}).`,
    );
  }

  await fs.mkdir(checkpointStoreDir, { recursive: true });
  const gitBefore = await captureGitStatusSnapshot(proposal.workspacePath);
  const checkpointId = `chk-${randomUUID().slice(0, 12)}`;

  let existingBytes: Buffer | null = null;
  try {
    existingBytes = await fs.readFile(absolutePath);
  } catch {
    existingBytes = null;
  }

  const existedBefore = existingBytes !== null;
  const beforeHash = existingBytes ? hashContent(existingBytes) : null;
  let backupFilePath: string | null = null;

  if (existingBytes !== null) {
    backupFilePath = join(checkpointStoreDir, `${checkpointId}.bak`);
    await fs.writeFile(backupFilePath, existingBytes);
    const verifyBackup = await fs.readFile(backupFilePath);
    if (hashContent(verifyBackup) !== beforeHash) {
      throw new Error(
        `Checkpoint backup verification failed for "${relativePath}"; aborting write.`,
      );
    }
  }

  let afterHash: string | null = null;
  if (proposal.kind === "create_file" || proposal.kind === "edit_file") {
    const nextContent = proposal.proposedContent ?? "";
    const expectedAfterHash = hashContent(nextContent);
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, nextContent, "utf8");
    const diskBytes = await fs.readFile(absolutePath);
    afterHash = hashContent(diskBytes);
    if (afterHash !== expectedAfterHash) {
      throw new Error(
        `Post-write hash verification failed for "${relativePath}".`,
      );
    }
  } else {
    // delete_file
    if (!existedBefore) {
      throw new Error(
        `Cannot delete missing file "${relativePath}".`,
      );
    }
    await fs.rm(absolutePath);
    let stillExists = false;
    try {
      await fs.stat(absolutePath);
      stillExists = true;
    } catch {
      stillExists = false;
    }
    if (stillExists) {
      throw new Error(`File "${relativePath}" still exists after delete.`);
    }
    afterHash = null;
  }

  const now = new Date().toISOString();
  const checkpoint: FileCheckpoint = {
    id: checkpointId,
    actionId: proposal.id,
    kind: proposal.kind,
    workspacePath: resolve(proposal.workspacePath),
    relativePath,
    targetFilePath: absolutePath,
    existedBefore,
    beforeHash,
    afterHash,
    backupFilePath,
    gitBefore,
    createdAt: now,
    rolledBackAt: null,
    rollbackVerification: "NOT VERIFIED",
    rollbackDetail: null,
  };

  await saveCheckpointRecord(checkpointStoreDir, checkpoint);

  const updatedAction: ProposedAction = {
    ...proposal,
    status: "executed",
    updatedAt: now,
    recovery: {
      strategy: "file_checkpoint",
      checkpointId: checkpoint.id,
      restorable: true,
      description: `Checkpoint ${checkpoint.id} stored outside workspace (beforeHash: ${beforeHash ? beforeHash.slice(0, 12) : "none"}).`,
    },
    evidence: {
      state: "PASS",
      summary: `Executed ${proposal.kind} on ${relativePath} with checkpoint ${checkpoint.id}.`,
      detail: `Before hash: ${beforeHash ? beforeHash.slice(0, 12) : "none"} → After hash: ${afterHash ? afterHash.slice(0, 12) : "deleted"}.`,
      beforeHash,
      afterHash,
      durationMs: Date.now() - startedAt,
      recordedAt: now,
    },
  };

  return { action: updatedAction, checkpoint };
}

export async function rollbackCheckpoint(
  checkpointId: string,
  checkpointStoreDir: string,
): Promise<{
  checkpoint: FileCheckpoint;
  verified: boolean;
  detail: string;
}> {
  const raw = await fs.readFile(
    metadataFilePath(checkpointStoreDir, checkpointId),
    "utf8",
  );
  const checkpoint = JSON.parse(raw) as FileCheckpoint;
  const { absolutePath, relativePath } = resolveWorkspaceTarget(
    checkpoint.workspacePath,
    checkpoint.relativePath,
  );

  let verified = false;
  let detail = "";

  if (!checkpoint.existedBefore) {
    try {
      await fs.rm(absolutePath, { force: true });
    } catch {
      // Confirm absence below.
    }
    let existsAfterRollback = false;
    try {
      await fs.stat(absolutePath);
      existsAfterRollback = true;
    } catch {
      existsAfterRollback = false;
    }
    verified = !existsAfterRollback;
    detail = verified
      ? `Removed newly created file ${relativePath} and verified absence on disk.`
      : `Rollback failed: ${relativePath} still exists on disk.`;
  } else {
    if (!checkpoint.backupFilePath) {
      throw new Error(
        `Checkpoint ${checkpointId} is missing its backup file path.`,
      );
    }
    const backupBytes = await fs.readFile(checkpoint.backupFilePath);
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, backupBytes);
    const restoredBytes = await fs.readFile(absolutePath);
    const restoredHash = hashContent(restoredBytes);
    verified = restoredHash === checkpoint.beforeHash;
    detail = verified
      ? `Restored ${relativePath} and verified SHA-256 ${restoredHash.slice(0, 12)} matches pre-change state.`
      : `Rollback hash mismatch on ${relativePath}: expected ${checkpoint.beforeHash}, got ${restoredHash}.`;
  }

  const updatedCheckpoint: FileCheckpoint = {
    ...checkpoint,
    rolledBackAt: new Date().toISOString(),
    rollbackVerification: verified ? "PASS" : "FAIL",
    rollbackDetail: detail,
  };

  await saveCheckpointRecord(checkpointStoreDir, updatedCheckpoint);

  return {
    checkpoint: updatedCheckpoint,
    verified,
    detail,
  };
}

export async function rollbackLastAction(
  checkpointStoreDir: string,
  workspacePath?: string,
): Promise<{
  checkpoint: FileCheckpoint;
  verified: boolean;
  detail: string;
}> {
  const checkpoints = await listCheckpoints(checkpointStoreDir, workspacePath);
  const candidate = checkpoints.find((item) => item.rolledBackAt === null);
  if (!candidate) {
    throw new Error("No active checkpoint available to roll back.");
  }
  return rollbackCheckpoint(candidate.id, checkpointStoreDir);
}

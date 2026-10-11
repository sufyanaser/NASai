import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
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

export interface TaskEvidence {
  id: string;
  prompt: string;
  workspace: string;
  startedAt: string;
  completedAt: string;
  status: GateState;
  summary: string;
  checks: Array<{ label: string; state: GateState; detail: string }>;
  proposals?: ProposedAction[];
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

export async function runEvidenceTask(
  prompt: string,
  workspacePath: string,
): Promise<TaskEvidence> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error("Task description is required.");
  const startedAt = new Date().toISOString();
  const snapshot = await inspectWorkspace(workspacePath);
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

  return {
    id: randomUUID(),
    prompt: normalizedPrompt,
    workspace: snapshot.path,
    startedAt,
    completedAt: new Date().toISOString(),
    status: failed ? "FAIL" : incomplete ? "NOT VERIFIED" : "PASS",
    summary: `Inspected ${snapshot.fileCount} files and captured ${checks.length} evidence checks. No workspace files were changed.`,
    checks,
    proposals,
  };
}


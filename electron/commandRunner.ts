import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CommandSpec, ProposedAction } from "./proposals.js";
import type { GateState } from "./workspace.js";

export interface CommandExecutionOptions {
  timeoutMs?: number;
  expectedExitCode?: number;
  expectedOutputIncludes?: string;
  expectedFileRelativePath?: string;
  signal?: AbortSignal;
}

export interface CommandRunResult {
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

const ALLOWED_EXECUTABLES = new Set(["git", "node", "npm", "npx"]);
const MAX_OUTPUT_CHARS = 64_000;
const runningProcesses = new Map<string, ChildProcess>();

export function cancelActiveCommand(actionId: string): boolean {
  const proc = runningProcesses.get(actionId);
  if (!proc) return false;
  proc.kill();
  runningProcesses.delete(actionId);
  return true;
}

export function validateCommandSpec(
  workspacePath: string,
  command: CommandSpec,
): { executable: string; args: string[]; cwd: string } {
  if (!command || typeof command.executable !== "string") {
    throw new Error("Command specification must provide an executable name.");
  }
  const rawExec = command.executable.trim();
  const normalizedExec = rawExec.toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
  if (!ALLOWED_EXECUTABLES.has(normalizedExec)) {
    throw new Error(
      `Executable "${rawExec}" is not permitted by the safe command runner allowlist.`,
    );
  }
  if (!Array.isArray(command.args)) {
    throw new Error("Command arguments must be an explicit string array.");
  }

  const canonicalRoot = resolve(workspacePath);
  const args = command.args.map((arg) => String(arg));

  for (const arg of args) {
    if (arg.includes("\0") || arg.includes("\n") || arg.includes("\r")) {
      throw new Error("Command arguments cannot contain control characters.");
    }
    if (
      arg === ".." ||
      arg.startsWith("../") ||
      arg.startsWith("..\\") ||
      arg.includes("/../") ||
      arg.includes("\\..\\")
    ) {
      throw new Error(
        `Command argument "${arg}" escapes the active workspace scope.`,
      );
    }
    if (isAbsolute(arg)) {
      const resolvedArg = resolve(arg);
      const rel = relative(canonicalRoot, resolvedArg);
      if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
        throw new Error(
          `Absolute path argument "${arg}" escapes the active workspace scope.`,
        );
      }
    }
  }

  if (normalizedExec === "git") {
    const subcommand = (args[0] ?? "").toLowerCase();
    const joinedFlags = args.map((a) => a.toLowerCase());
    if (
      joinedFlags.includes("-c") ||
      joinedFlags.includes("--git-dir") ||
      joinedFlags.includes("--work-tree")
    ) {
      throw new Error("Git directory override flags are forbidden.");
    }
    if (
      subcommand === "reset" &&
      (joinedFlags.includes("--hard") || joinedFlags.includes("--merge"))
    ) {
      throw new Error("Destructive git reset flags are forbidden.");
    }
    if (
      subcommand === "checkout" &&
      (joinedFlags.includes("--") ||
        joinedFlags.includes("-f") ||
        joinedFlags.includes("--force"))
    ) {
      throw new Error("Destructive git checkout flags are forbidden.");
    }
    if (
      subcommand === "clean" &&
      joinedFlags.some((flag) => flag.startsWith("-f") || flag === "--force")
    ) {
      throw new Error("Destructive git clean is forbidden.");
    }
    if (
      subcommand === "push" &&
      (joinedFlags.includes("--force") || joinedFlags.includes("-f"))
    ) {
      throw new Error("Force git push is forbidden.");
    }
  }

  if (normalizedExec === "node") {
    const blockedNodeFlags = new Set(["-e", "--eval", "-p", "--print"]);
    for (const arg of args) {
      if (blockedNodeFlags.has(arg.toLowerCase())) {
        throw new Error(
          `Inline script evaluation flag "${arg}" is forbidden in the safe command runner.`,
        );
      }
    }
  }

  return {
    executable: normalizedExec,
    args,
    cwd: canonicalRoot,
  };
}

async function resolveSpawnTarget(
  executable: string,
  args: string[],
): Promise<{ bin: string; spawnArgs: string[] }> {
  if (process.platform === "win32" && (executable === "npm" || executable === "npx")) {
    const cliName = executable === "npm" ? "npm-cli.js" : "npx-cli.js";
    const candidates = [
      join(dirname(process.execPath), "node_modules", "npm", "bin", cliName),
      join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "nodejs",
        "node_modules",
        "npm",
        "bin",
        cliName,
      ),
    ];
    for (const candidate of candidates) {
      try {
        await fs.stat(candidate);
        return { bin: "node", spawnArgs: [candidate, ...args] };
      } catch {
        // Try next candidate
      }
    }
  }
  return { bin: executable, spawnArgs: args };
}

export async function executeApprovedCommand(
  proposal: ProposedAction,
  options: CommandExecutionOptions = {},
): Promise<{ action: ProposedAction; result: CommandRunResult }> {
  if (proposal.kind !== "run_command" && proposal.kind !== "git_operation") {
    throw new Error(
      `Proposal "${proposal.id}" is not a command or Git action.`,
    );
  }
  if (proposal.status !== "approved") {
    throw new Error(
      `Cannot execute command "${proposal.target}" without explicit single-action approval (current status: ${proposal.status}).`,
    );
  }
  if (!proposal.command) {
    throw new Error("Command proposal is missing its structured CommandSpec.");
  }

  const validated = validateCommandSpec(
    proposal.workspacePath,
    proposal.command,
  );
  const rootStats = await fs.stat(validated.cwd);
  if (!rootStats.isDirectory()) {
    throw new Error("Workspace working directory does not exist.");
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const expectedExitCode = options.expectedExitCode ?? 0;
  const startedAt = Date.now();
  const { bin, spawnArgs } = await resolveSpawnTarget(
    validated.executable,
    validated.args,
  );

  const runOutcome = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
  }>((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(bin, spawnArgs, {
      cwd: validated.cwd,
      shell: false,
      windowsHide: true,
    });

    runningProcesses.set(proposal.id, child);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const onAbort = () => {
      cancelled = true;
      child.kill();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += chunk.toString().slice(0, MAX_OUTPUT_CHARS - stdout.length);
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) {
        stderr += chunk.toString().slice(0, MAX_OUTPUT_CHARS - stderr.length);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      runningProcesses.delete(proposal.id);
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const wasRemovedByCancel = !runningProcesses.has(proposal.id);
      runningProcesses.delete(proposal.id);
      if (!settled) {
        settled = true;
        resolvePromise({
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          cancelled: cancelled || (wasRemovedByCancel && !timedOut),
        });
      }
    });
  });

  const durationMs = Date.now() - startedAt;
  let evidencePassed =
    !runOutcome.timedOut &&
    !runOutcome.cancelled &&
    runOutcome.exitCode === expectedExitCode;

  let verificationNote = `exit code ${runOutcome.exitCode ?? "null"} in ${durationMs}ms`;

  if (evidencePassed && options.expectedOutputIncludes) {
    const combined = `${runOutcome.stdout}\n${runOutcome.stderr}`;
    if (!combined.includes(options.expectedOutputIncludes)) {
      evidencePassed = false;
      verificationNote += ` · missing expected output "${options.expectedOutputIncludes}"`;
    } else {
      verificationNote += ` · matched expected output "${options.expectedOutputIncludes}"`;
    }
  }

  if (evidencePassed && options.expectedFileRelativePath) {
    const expectedPath = resolve(validated.cwd, options.expectedFileRelativePath);
    try {
      await fs.stat(expectedPath);
      verificationNote += ` · verified artifact ${options.expectedFileRelativePath}`;
    } catch {
      evidencePassed = false;
      verificationNote += ` · missing expected artifact ${options.expectedFileRelativePath}`;
    }
  }

  if (runOutcome.timedOut) {
    verificationNote = `Timed out after ${timeoutMs}ms`;
  } else if (runOutcome.cancelled) {
    verificationNote = `Cancelled after ${durationMs}ms`;
  }

  const state: GateState = evidencePassed ? "PASS" : "FAIL";
  const summary = evidencePassed
    ? `Command "${validated.executable} ${validated.args.join(" ")}" succeeded (${verificationNote}).`
    : `Command "${validated.executable} ${validated.args.join(" ")}" failed (${verificationNote}).`;

  const result: CommandRunResult = {
    actionId: proposal.id,
    executable: validated.executable,
    args: validated.args,
    cwd: validated.cwd,
    exitCode: runOutcome.exitCode,
    stdout: runOutcome.stdout,
    stderr: runOutcome.stderr,
    durationMs,
    timedOut: runOutcome.timedOut,
    cancelled: runOutcome.cancelled,
    state,
    summary,
  };

  const now = new Date().toISOString();
  const updatedAction: ProposedAction = {
    ...proposal,
    status: evidencePassed ? "executed" : "failed",
    updatedAt: now,
    evidence: {
      state,
      summary,
      detail:
        runOutcome.stdout.trim().slice(0, 240) ||
        runOutcome.stderr.trim().slice(0, 240) ||
        verificationNote,
      exitCode: runOutcome.exitCode,
      stdout: runOutcome.stdout,
      stderr: runOutcome.stderr,
      durationMs,
      recordedAt: now,
    },
  };

  return { action: updatedAction, result };
}

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GateState } from "./workspace.js";

export type ActionKind =
  | "read_file"
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "git_operation";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ActionStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "rolled_back";

export interface CommandSpec {
  executable: string;
  args: string[];
}

export interface ActionEvidence {
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

export interface RecoveryPlan {
  strategy: "none" | "file_checkpoint" | "git_inspect_only";
  checkpointId: string | null;
  restorable: boolean;
  description: string;
}

export interface ProposedAction {
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

export interface ProposalInput {
  id?: string;
  kind: ActionKind;
  description: string;
  reason: string;
  targetPath?: string;
  proposedContent?: string;
  command?: CommandSpec;
}

const SENSITIVE_COMMAND_PATTERNS: Array<{
  pattern: RegExp;
  risk: RiskLevel;
  reason: string;
}> = [
  {
    pattern: /\b(publish|release|deploy|push)\b/i,
    risk: "critical",
    reason: "Publishing or pushing affects external state",
  },
  {
    pattern: /\b(install|add|remove|uninstall|update|upgrade|ci)\b/i,
    risk: "high",
    reason: "Package installation or dependency mutation",
  },
  {
    pattern: /\b(curl|wget|fetch|http|https|invoke-webrequest)\b/i,
    risk: "high",
    reason: "Network operation requires explicit review",
  },
  {
    pattern: /\b(rm|del|rmdir|erase|clean|reset|checkout)\b/i,
    risk: "critical",
    reason: "Potentially destructive file or Git operation",
  },
];

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function resolveWorkspaceTarget(
  workspacePath: string,
  targetPath: string,
): { absolutePath: string; relativePath: string } {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new Error("Target path is required.");
  }
  const canonicalRoot = resolve(workspacePath);
  const candidate = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(canonicalRoot, trimmed);
  const rel = relative(canonicalRoot, candidate);

  if (
    rel === "" ||
    rel === "." ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    rel.split(sep).includes("..")
  ) {
    throw new Error(
      `Target path "${targetPath}" escapes the active workspace scope.`,
    );
  }

  return {
    absolutePath: candidate,
    relativePath: rel.replaceAll("\\", "/"),
  };
}

export function classifyActionRisk(
  kind: ActionKind,
  command?: CommandSpec,
): {
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  sensitiveReason: string | null;
} {
  switch (kind) {
    case "read_file":
      return {
        riskLevel: "low",
        requiresApproval: false,
        sensitiveReason: null,
      };
    case "create_file":
      return {
        riskLevel: "medium",
        requiresApproval: true,
        sensitiveReason: "Creating a workspace file writes to disk",
      };
    case "edit_file":
      return {
        riskLevel: "medium",
        requiresApproval: true,
        sensitiveReason: "Modifying an existing workspace file writes to disk",
      };
    case "delete_file":
      return {
        riskLevel: "high",
        requiresApproval: true,
        sensitiveReason: "Deleting a workspace file is a destructive write",
      };
    case "git_operation": {
      const joined = command
        ? `${command.executable} ${command.args.join(" ")}`
        : "git";
      for (const rule of SENSITIVE_COMMAND_PATTERNS) {
        if (rule.pattern.test(joined)) {
          return {
            riskLevel: rule.risk,
            requiresApproval: true,
            sensitiveReason: rule.reason,
          };
        }
      }
      return {
        riskLevel: "medium",
        requiresApproval: true,
        sensitiveReason: "Git operations require explicit human approval",
      };
    }
    case "run_command": {
      const joined = command
        ? `${command.executable} ${command.args.join(" ")}`
        : "";
      for (const rule of SENSITIVE_COMMAND_PATTERNS) {
        if (rule.pattern.test(joined)) {
          return {
            riskLevel: rule.risk,
            requiresApproval: true,
            sensitiveReason: rule.reason,
          };
        }
      }
      return {
        riskLevel: "medium",
        requiresApproval: true,
        sensitiveReason: "Command execution inside the workspace requires approval",
      };
    }
  }
}

export function buildUnifiedDiff(
  relativePath: string,
  beforeContent: string | null,
  afterContent: string | null,
): string {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (beforeContent === null && afterContent !== null) {
    const lines = afterContent.split(/\r?\n/);
    return [
      `--- /dev/null`,
      `+++ b/${normalizedPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
  }

  if (beforeContent !== null && afterContent === null) {
    const lines = beforeContent.split(/\r?\n/);
    return [
      `--- a/${normalizedPath}`,
      `+++ /dev/null`,
      `@@ -1,${lines.length} +0,0 @@`,
      ...lines.map((line) => `-${line}`),
    ].join("\n");
  }

  const beforeLines = (beforeContent ?? "").split(/\r?\n/);
  const afterLines = (afterContent ?? "").split(/\r?\n/);
  const diffLines: string[] = [
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i += 1) {
    const oldLine = beforeLines[i];
    const newLine = afterLines[i];
    if (oldLine === newLine && oldLine !== undefined) {
      diffLines.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) diffLines.push(`-${oldLine}`);
      if (newLine !== undefined) diffLines.push(`+${newLine}`);
    }
  }

  return diffLines.join("\n");
}

function buildStableProposalId(
  workspacePath: string,
  input: ProposalInput,
  target: string,
): string {
  if (input.id && input.id.trim()) return input.id.trim();
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        workspacePath: resolve(workspacePath),
        kind: input.kind,
        target,
        description: input.description,
        reason: input.reason,
        proposedContent: input.proposedContent ?? null,
        command: input.command ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `prop-${digest}`;
}

export async function createProposedAction(
  workspacePath: string,
  input: ProposalInput,
): Promise<ProposedAction> {
  const description = input.description.trim();
  const reason = input.reason.trim();
  if (!description) throw new Error("Proposal description is required.");
  if (!reason) throw new Error("Proposal reason is required.");

  const now = new Date().toISOString();
  const risk = classifyActionRisk(input.kind, input.command);

  if (input.kind === "run_command" || input.kind === "git_operation") {
    if (!input.command || !input.command.executable.trim()) {
      throw new Error("Command executable is required for command proposals.");
    }
    const executable = input.command.executable.trim();
    const args = input.command.args.map((arg) => String(arg));
    if (input.kind === "git_operation" && executable.toLowerCase() !== "git") {
      throw new Error("Git operation proposals must use the git executable.");
    }
    const formattedTarget = [executable, ...args].join(" ").trim();
    const preview = [
      `# Working directory: ${resolve(workspacePath)}`,
      `# Executable: ${executable}`,
      `# Arguments (${args.length}): ${JSON.stringify(args)}`,
      `$ ${formattedTarget}`,
    ].join("\n");

    const recovery: RecoveryPlan =
      input.kind === "git_operation"
        ? {
            strategy: "git_inspect_only",
            checkpointId: null,
            restorable: false,
            description:
              "Inspect Git status and reflog before and after operation; destructive Git flags are blocked.",
          }
        : {
            strategy: "none",
            checkpointId: null,
            restorable: false,
            description:
              "Restricted command execution inside workspace scope; verify exit code and output.",
          };

    return {
      id: buildStableProposalId(workspacePath, input, formattedTarget),
      kind: input.kind,
      description,
      reason,
      target: formattedTarget,
      workspacePath: resolve(workspacePath),
      command: { executable, args },
      riskLevel: risk.riskLevel,
      requiresApproval: risk.requiresApproval,
      sensitiveReason: risk.sensitiveReason,
      preview,
      status: "pending_approval",
      evidence: null,
      recovery,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!input.targetPath) {
    throw new Error("Target file path is required for file proposals.");
  }

  const { absolutePath, relativePath } = resolveWorkspaceTarget(
    workspacePath,
    input.targetPath,
  );

  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(absolutePath, "utf8");
  } catch {
    existingContent = null;
  }

  let preview = "";
  let recovery: RecoveryPlan;

  if (input.kind === "read_file") {
    const sample =
      existingContent === null
        ? "(File does not exist yet)"
        : existingContent.split(/\r?\n/).slice(0, 20).join("\n");
    preview = `--- read ${relativePath} ---\n${sample}`;
    recovery = {
      strategy: "none",
      checkpointId: null,
      restorable: false,
      description: "Read-only inspection; no workspace files are modified.",
    };
  } else if (input.kind === "create_file") {
    if (existingContent !== null) {
      throw new Error(
        `Cannot propose create_file for existing file "${relativePath}". Use edit_file instead.`,
      );
    }
    const after = input.proposedContent ?? "";
    preview = buildUnifiedDiff(relativePath, null, after);
    recovery = {
      strategy: "file_checkpoint",
      checkpointId: null,
      restorable: true,
      description: `Checkpoint records absence of ${relativePath} and removes the created file on rollback.`,
    };
  } else if (input.kind === "edit_file") {
    if (existingContent === null) {
      throw new Error(
        `Cannot propose edit_file for missing file "${relativePath}". Use create_file instead.`,
      );
    }
    const after = input.proposedContent ?? "";
    preview = buildUnifiedDiff(relativePath, existingContent, after);
    recovery = {
      strategy: "file_checkpoint",
      checkpointId: null,
      restorable: true,
      description: `Checkpoint backs up ${relativePath} (SHA-256 ${hashContent(existingContent).slice(0, 12)}) outside the workspace before writing.`,
    };
  } else {
    // delete_file
    if (existingContent === null) {
      throw new Error(
        `Cannot propose delete_file for missing file "${relativePath}".`,
      );
    }
    preview = buildUnifiedDiff(relativePath, existingContent, null);
    recovery = {
      strategy: "file_checkpoint",
      checkpointId: null,
      restorable: true,
      description: `Checkpoint backs up ${relativePath} (SHA-256 ${hashContent(existingContent).slice(0, 12)}) outside the workspace so deletion can be restored.`,
    };
  }

  return {
    id: buildStableProposalId(workspacePath, input, relativePath),
    kind: input.kind,
    description,
    reason,
    target: relativePath,
    workspacePath: resolve(workspacePath),
    relativePath,
    proposedContent: input.proposedContent,
    riskLevel: risk.riskLevel,
    requiresApproval: risk.requiresApproval,
    sensitiveReason: risk.sensitiveReason,
    preview,
    status: "pending_approval",
    evidence: null,
    recovery,
    createdAt: now,
    updatedAt: now,
  };
}

export async function proposeActionsForTask(
  workspacePath: string,
  prompt: string,
  rules: string[],
  gitAvailable: boolean,
): Promise<ProposedAction[]> {
  const proposals: ProposedAction[] = [];
  const primaryRule = rules[0] ?? "AGENTS.md";

  if (rules.length > 0) {
    proposals.push(
      await createProposedAction(workspacePath, {
        kind: "read_file",
        description: `Read project rule file ${primaryRule}`,
        reason: `Load canonical engineering constraints before acting on "${prompt.slice(0, 80)}"`,
        targetPath: primaryRule,
      }),
    );
  }

  if (gitAvailable) {
    proposals.push(
      await createProposedAction(workspacePath, {
        kind: "git_operation",
        description: "Inspect working tree status via git status --short",
        reason: "Verify current Git working tree state before any modification",
        command: { executable: "git", args: ["status", "--short"] },
      }),
    );
  }

  return proposals;
}

export interface ApprovalDecisionInput {
  actionId: string;
  decision: "approve" | "reject";
  scope?: "single_action" | "blanket" | "session";
}

export function decideProposal(
  proposal: ProposedAction,
  input: ApprovalDecisionInput,
): ProposedAction {
  if (input.scope && input.scope !== "single_action") {
    throw new Error(
      "Blanket or session-wide approvals are forbidden by NASai policy. Approve a single action only.",
    );
  }
  if (!input.actionId || input.actionId !== proposal.id) {
    throw new Error(
      "Approval must target a single explicit proposal ID.",
    );
  }
  if (proposal.status !== "pending_approval") {
    throw new Error(
      `Proposal ${proposal.id} cannot be decided from status "${proposal.status}".`,
    );
  }

  const now = new Date().toISOString();
  if (input.decision === "reject") {
    return {
      ...proposal,
      status: "rejected",
      updatedAt: now,
      evidence: {
        state: "NOT VERIFIED",
        summary: "Action rejected by user before execution.",
        detail: `User rejected ${proposal.kind} on ${proposal.target}; no changes were made.`,
        recordedAt: now,
      },
    };
  }

  return {
    ...proposal,
    status: "approved",
    updatedAt: now,
  };
}

export interface ProposalEditInput {
  description?: string;
  reason?: string;
  proposedContent?: string;
  commandArgs?: string[];
}

export async function editProposedAction(
  proposal: ProposedAction,
  edits: ProposalEditInput,
): Promise<ProposedAction> {
  if (
    proposal.status === "executed" ||
    proposal.status === "rolled_back"
  ) {
    throw new Error(
      `Cannot edit proposal ${proposal.id} after execution.`,
    );
  }

  const updated = await createProposedAction(proposal.workspacePath, {
    id: proposal.id,
    kind: proposal.kind,
    description: edits.description ?? proposal.description,
    reason: edits.reason ?? proposal.reason,
    targetPath: proposal.relativePath,
    proposedContent:
      edits.proposedContent !== undefined
        ? edits.proposedContent
        : proposal.proposedContent,
    command: proposal.command
      ? {
          executable: proposal.command.executable,
          args: edits.commandArgs ?? proposal.command.args,
        }
      : undefined,
  });

  return {
    ...updated,
    createdAt: proposal.createdAt,
    status: "pending_approval",
  };
}



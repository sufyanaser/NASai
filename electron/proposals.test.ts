// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProposedAction,
  proposeActionsForTask,
  resolveWorkspaceTarget,
} from "./proposals.js";

let tempWorkspace: string | null = null;

afterEach(async () => {
  if (tempWorkspace?.startsWith(tmpdir())) {
    await fs.rm(tempWorkspace, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  tempWorkspace = null;
});

describe("Stage 1: ProposedAction engine", () => {
  it("represents read, create, edit, delete, command, and git proposals without modifying files", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-proposals-"));
    const existingFile = join(tempWorkspace, "src", "config.ts");
    await fs.mkdir(join(tempWorkspace, "src"), { recursive: true });
    await fs.writeFile(existingFile, 'export const mode = "safe";\n', "utf8");
    await fs.writeFile(join(tempWorkspace, "AGENTS.md"), "# Rules\n", "utf8");

    const readProposal = await createProposedAction(tempWorkspace, {
      kind: "read_file",
      description: "Read src/config.ts",
      reason: "Inspect current configuration before proposing edits",
      targetPath: "src/config.ts",
    });
    expect(readProposal.id).toMatch(/^prop-[a-f0-9]{12}$/);
    expect(readProposal.riskLevel).toBe("low");
    expect(readProposal.requiresApproval).toBe(false);
    expect(readProposal.preview).toContain('export const mode = "safe";');
    expect(readProposal.status).toBe("pending_approval");
    expect(readProposal.evidence).toBeNull();
    expect(readProposal.recovery.strategy).toBe("none");

    const createProposal = await createProposedAction(tempWorkspace, {
      kind: "create_file",
      description: "Create src/feature.ts",
      reason: "Add isolated helper module",
      targetPath: "src/feature.ts",
      proposedContent: "export const enabled = true;\n",
    });
    expect(createProposal.requiresApproval).toBe(true);
    expect(createProposal.riskLevel).toBe("medium");
    expect(createProposal.preview).toContain("+++ b/src/feature.ts");
    expect(createProposal.preview).toContain("+export const enabled = true;");
    expect(createProposal.recovery.restorable).toBe(true);
    await expect(
      fs.stat(join(tempWorkspace, "src", "feature.ts")),
    ).rejects.toThrow();

    const editProposal = await createProposedAction(tempWorkspace, {
      kind: "edit_file",
      description: "Update mode in src/config.ts",
      reason: "Switch to strict verification mode",
      targetPath: "src/config.ts",
      proposedContent: 'export const mode = "strict";\n',
    });
    expect(editProposal.requiresApproval).toBe(true);
    expect(editProposal.preview).toContain('-export const mode = "safe";');
    expect(editProposal.preview).toContain('+export const mode = "strict";');
    expect(editProposal.recovery.strategy).toBe("file_checkpoint");
    expect(await fs.readFile(existingFile, "utf8")).toBe(
      'export const mode = "safe";\n',
    );

    const deleteProposal = await createProposedAction(tempWorkspace, {
      kind: "delete_file",
      description: "Remove obsolete src/config.ts",
      reason: "Clean up deprecated module after migration",
      targetPath: "src/config.ts",
    });
    expect(deleteProposal.riskLevel).toBe("high");
    expect(deleteProposal.requiresApproval).toBe(true);
    expect(deleteProposal.preview).toContain("+++ /dev/null");
    expect(await fs.readFile(existingFile, "utf8")).toBe(
      'export const mode = "safe";\n',
    );

    const cmdProposal = await createProposedAction(tempWorkspace, {
      kind: "run_command",
      description: "Run unit test suite",
      reason: "Verify no regressions before commit",
      command: { executable: "npm", args: ["test"] },
    });
    expect(cmdProposal.requiresApproval).toBe(true);
    expect(cmdProposal.target).toBe("npm test");
    expect(cmdProposal.preview).toContain('Arguments (1): ["test"]');

    const gitProposal = await createProposedAction(tempWorkspace, {
      kind: "git_operation",
      description: "Check Git status",
      reason: "Inspect working tree cleanliness",
      command: { executable: "git", args: ["status", "--short"] },
    });
    expect(gitProposal.requiresApproval).toBe(true);
    expect(gitProposal.recovery.strategy).toBe("git_inspect_only");

    const taskProposals = await proposeActionsForTask(
      tempWorkspace,
      "Inspect rules and git status",
      ["AGENTS.md"],
      true,
    );
    expect(taskProposals).toHaveLength(2);
  });

  it("rejects paths that escape the workspace boundary", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-proposals-scope-"));
    expect(() =>
      resolveWorkspaceTarget(tempWorkspace!, "../outside-secret.txt"),
    ).toThrow(/escapes the active workspace scope/);

    await expect(
      createProposedAction(tempWorkspace, {
        kind: "read_file",
        description: "Attempt traversal",
        reason: "Should be blocked",
        targetPath: "..\\outside.txt",
      }),
    ).rejects.toThrow(/escapes the active workspace scope/);
  });
});

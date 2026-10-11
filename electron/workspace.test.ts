// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectWorkspace,
  runEvidenceTask,
  runRepresentativeSafeEditCycle,
} from "./workspace.js";

let temporaryWorkspace: string | null = null;
let temporaryCheckpoints: string | null = null;

afterEach(async () => {
  for (const dir of [temporaryWorkspace, temporaryCheckpoints]) {
    if (dir?.startsWith(tmpdir()))
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  }
  temporaryWorkspace = null;
  temporaryCheckpoints = null;
});

describe("workspace evidence engine", () => {
  it("discovers files and supported project rules without modifying them", async () => {
    temporaryWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-workspace-"));
    await fs.writeFile(join(temporaryWorkspace, "AGENTS.md"), "# Rules");
    await fs.writeFile(join(temporaryWorkspace, "index.ts"), "export {};");
    await fs.mkdir(join(temporaryWorkspace, "release-locked"));
    await fs.writeFile(
      join(temporaryWorkspace, "release-locked", "generated.exe"),
      "ignored",
    );

    const snapshot = await inspectWorkspace(temporaryWorkspace);
    const task = await runEvidenceTask(
      "Inspect this workspace",
      temporaryWorkspace,
    );

    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.rules).toEqual(["AGENTS.md"]);
    expect(task.status).toBe("NOT VERIFIED");
    expect(task.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Workspace scope", state: "PASS" }),
        expect.objectContaining({ label: "Project rules", state: "PASS" }),
      ]),
    );
    expect(
      await fs.readFile(join(temporaryWorkspace, "index.ts"), "utf8"),
    ).toBe("export {};");
  });

  it("Stage 5: completes the 10-step safe edit, approval, checkpoint, verification gate, and rollback cycle in an isolated fixture", async () => {
    temporaryWorkspace = await fs.mkdtemp(
      join(tmpdir(), "nasai-cycle-fixture-"),
    );
    temporaryCheckpoints = await fs.mkdtemp(
      join(tmpdir(), "nasai-cycle-chk-"),
    );

    const report = await runRepresentativeSafeEditCycle(
      temporaryWorkspace,
      temporaryCheckpoints,
    );

    // 1. Discover Workspace
    expect(report.workspaceSnapshot.gitAvailable).toBe(true);
    expect(report.workspaceSnapshot.rules).toContain("AGENTS.md");
    expect(report.workspaceSnapshot.dirty).toBe(true);

    // 2 & 3. Create proposal & show diff
    expect(report.editProposal.kind).toBe("edit_file");
    expect(report.diffPreview).toContain("-  return a - b;");
    expect(report.diffPreview).toContain("+  return a + b;");

    // 4. Unapproved write blocked before approval
    expect(report.unapprovedBlocked).toBe(true);

    // 5 & 6. Checkpoint created & edit executed
    expect(report.checkpoint.beforeHash).not.toBeNull();
    expect(report.checkpoint.afterHash).not.toBeNull();
    expect(report.checkpoint.beforeHash).not.toBe(report.checkpoint.afterHash);
    expect(report.executedEdit.status).toBe("executed");

    // 7 & 8. Verification gate ran and produced PASS evidence
    expect(report.verificationCommandResult.state).toBe("PASS");
    expect(report.verificationCommandResult.exitCode).toBe(0);
    expect(report.verificationCommandResult.stdout).toContain(
      "VERIFY_MATH_PASS",
    );
    expect(report.taskEvidence.status).toBe("PASS");

    // 9 & 10. Rollback restored exact pre-change content and preserved unrelated user changes
    expect(report.rollbackResult.verified).toBe(true);
    expect(report.checkpoint.rollbackVerification).toBe("PASS");
    expect(report.userChangesPreserved).toBe(true);
    expect(
      await fs.readFile(join(temporaryWorkspace, "src", "math.mjs"), "utf8"),
    ).toBe("export function add(a, b) {\n  return a - b;\n}\n");
    expect(
      await fs.readFile(
        join(temporaryWorkspace, "src", "user-uncommitted.ts"),
        "utf8",
      ),
    ).toBe('export const userDraft = "do-not-touch-this-change";\n');
  });
});


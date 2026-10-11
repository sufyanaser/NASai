// @vitest-environment node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeApprovedFileAction,
  listCheckpoints,
  rollbackCheckpoint,
  rollbackLastAction,
} from "./checkpoints.js";
import {
  createProposedAction,
  decideProposal,
  hashContent,
} from "./proposals.js";

const execFileAsync = promisify(execFile);

let tempWorkspace: string | null = null;
let tempCheckpointStore: string | null = null;

afterEach(async () => {
  for (const dir of [tempWorkspace, tempCheckpointStore]) {
    if (dir?.startsWith(tmpdir())) {
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
  tempWorkspace = null;
  tempCheckpointStore = null;
});

describe("Stage 3: Recovery checkpoints and verified rollback", () => {
  it("refuses to write files unless the proposal was explicitly approved", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-chk-ws-"));
    tempCheckpointStore = await fs.mkdtemp(join(tmpdir(), "nasai-chk-store-"));

    const unapproved = await createProposedAction(tempWorkspace, {
      kind: "create_file",
      description: "Create file without approval",
      reason: "Test approval gate enforcement",
      targetPath: "unapproved.txt",
      proposedContent: "blocked",
    });

    await expect(
      executeApprovedFileAction(unapproved, tempCheckpointStore),
    ).rejects.toThrow(/without explicit single-action approval/);
    await expect(
      fs.stat(join(tempWorkspace, "unapproved.txt")),
    ).rejects.toThrow();
  });

  it("captures Git state, stores backups outside workspace, preserves user changes, and verifies rollback for edit, create, and delete", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-chk-git-ws-"));
    tempCheckpointStore = await fs.mkdtemp(join(tmpdir(), "nasai-chk-ext-"));

    await execFileAsync("git", ["init"], { cwd: tempWorkspace });
    await execFileAsync("git", ["config", "user.email", "test@nasai.local"], {
      cwd: tempWorkspace,
    });
    await execFileAsync("git", ["config", "user.name", "NASai Test"], {
      cwd: tempWorkspace,
    });

    const targetPath = join(tempWorkspace, "app.ts");
    const userDirtyFile = join(tempWorkspace, "user-work.ts");
    const originalTargetContent = 'export const version = "1.0.0";\n';
    const userUncommittedContent =
      "// User in-progress work that must never be touched\nexport const draft = 42;\n";

    await fs.writeFile(targetPath, originalTargetContent, "utf8");
    await fs.writeFile(userDirtyFile, "export const draft = 1;\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempWorkspace });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempWorkspace,
    });

    // Leave uncommitted user work in user-work.ts
    await fs.writeFile(userDirtyFile, userUncommittedContent, "utf8");

    // 1. Edit app.ts with approval + checkpoint
    const editProposal = decideProposal(
      await createProposedAction(tempWorkspace, {
        kind: "edit_file",
        description: "Bump version in app.ts",
        reason: "Test verified checkpoint edit",
        targetPath: "app.ts",
        proposedContent: 'export const version = "1.1.0";\n',
      }),
      {
        actionId: (
          await createProposedAction(tempWorkspace, {
            kind: "edit_file",
            description: "Bump version in app.ts",
            reason: "Test verified checkpoint edit",
            targetPath: "app.ts",
            proposedContent: 'export const version = "1.1.0";\n',
          })
        ).id,
        decision: "approve",
        scope: "single_action",
      },
    );

    const { action: executedEdit, checkpoint: editCheckpoint } =
      await executeApprovedFileAction(editProposal, tempCheckpointStore);

    expect(executedEdit.status).toBe("executed");
    expect(executedEdit.evidence?.state).toBe("PASS");
    expect(editCheckpoint).not.toBeNull();
    expect(editCheckpoint!.gitBefore.gitAvailable).toBe(true);
    expect(editCheckpoint!.gitBefore.dirty).toBe(true);
    expect(editCheckpoint!.beforeHash).toBe(hashContent(originalTargetContent));
    expect(editCheckpoint!.backupFilePath?.startsWith(tempCheckpointStore)).toBe(
      true,
    );
    expect(await fs.readFile(targetPath, "utf8")).toBe(
      'export const version = "1.1.0";\n',
    );
    // User's unrelated dirty file is untouched
    expect(await fs.readFile(userDirtyFile, "utf8")).toBe(
      userUncommittedContent,
    );

    // Roll back the edit and verify content restoration
    const editRollback = await rollbackLastAction(
      tempCheckpointStore,
      tempWorkspace,
    );
    expect(editRollback.verified).toBe(true);
    expect(editRollback.checkpoint.rollbackVerification).toBe("PASS");
    expect(await fs.readFile(targetPath, "utf8")).toBe(originalTargetContent);
    expect(await fs.readFile(userDirtyFile, "utf8")).toBe(
      userUncommittedContent,
    );

    // 2. Create a new file and roll it back
    const createProp = await createProposedAction(tempWorkspace, {
      kind: "create_file",
      description: "Create helper.ts",
      reason: "Test create rollback",
      targetPath: "helper.ts",
      proposedContent: "export const helper = true;\n",
    });
    const approvedCreate = decideProposal(createProp, {
      actionId: createProp.id,
      decision: "approve",
      scope: "single_action",
    });
    const { checkpoint: createChk } = await executeApprovedFileAction(
      approvedCreate,
      tempCheckpointStore,
    );
    expect(
      await fs.readFile(join(tempWorkspace, "helper.ts"), "utf8"),
    ).toBe("export const helper = true;\n");

    const createRollback = await rollbackCheckpoint(
      createChk!.id,
      tempCheckpointStore,
    );
    expect(createRollback.verified).toBe(true);
    await expect(
      fs.stat(join(tempWorkspace, "helper.ts")),
    ).rejects.toThrow();

    // 3. Delete app.ts and roll it back
    const deleteProp = await createProposedAction(tempWorkspace, {
      kind: "delete_file",
      description: "Delete app.ts in isolated test fixture",
      reason: "Test delete recovery",
      targetPath: "app.ts",
    });
    const approvedDelete = decideProposal(deleteProp, {
      actionId: deleteProp.id,
      decision: "approve",
      scope: "single_action",
    });
    const { checkpoint: deleteChk } = await executeApprovedFileAction(
      approvedDelete,
      tempCheckpointStore,
    );
    await expect(fs.stat(targetPath)).rejects.toThrow();

    const deleteRollback = await rollbackCheckpoint(
      deleteChk!.id,
      tempCheckpointStore,
    );
    expect(deleteRollback.verified).toBe(true);
    expect(await fs.readFile(targetPath, "utf8")).toBe(originalTargetContent);
    expect(await fs.readFile(userDirtyFile, "utf8")).toBe(
      userUncommittedContent,
    );

    const savedCheckpoints = await listCheckpoints(
      tempCheckpointStore,
      tempWorkspace,
    );
    expect(savedCheckpoints).toHaveLength(3);
  });
});

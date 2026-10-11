// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeApprovedCommand,
  validateCommandSpec,
} from "./commandRunner.js";
import { createProposedAction, decideProposal } from "./proposals.js";

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

describe("Stage 4: Safe command runner", () => {
  it("blocks unapproved commands, disallowed executables, destructive git flags, inline eval, and workspace escapes", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-cmd-guard-"));

    const unapproved = await createProposedAction(tempWorkspace, {
      kind: "run_command",
      description: "Check node version",
      reason: "Test approval gate",
      command: { executable: "node", args: ["--version"] },
    });

    await expect(executeApprovedCommand(unapproved)).rejects.toThrow(
      /without explicit single-action approval/,
    );

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "powershell",
        args: ["-Command", "Get-Process"],
      }),
    ).toThrow(/not permitted by the safe command runner allowlist/);

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "git",
        args: ["reset", "--hard"],
      }),
    ).toThrow(/Destructive git reset flags are forbidden/);

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "git",
        args: ["checkout", "--", "."],
      }),
    ).toThrow(/Destructive git checkout flags are forbidden/);

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "git",
        args: ["clean", "-fd"],
      }),
    ).toThrow(/Destructive git clean is forbidden/);

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "node",
        args: ["-e", "process.exit(0)"],
      }),
    ).toThrow(/Inline script evaluation flag "-e" is forbidden/);

    expect(() =>
      validateCommandSpec(tempWorkspace!, {
        executable: "node",
        args: ["../escape.js"],
      }),
    ).toThrow(/escapes the active workspace scope/);
  });

  it("executes approved commands inside the workspace, validates exit code and expected output, and handles failures", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-cmd-run-"));
    const scriptPath = join(tempWorkspace, "verify-check.mjs");
    await fs.writeFile(
      scriptPath,
      'console.log("GATE_OK:42");\n',
      "utf8",
    );

    const proposal = await createProposedAction(tempWorkspace, {
      kind: "run_command",
      description: "Run verify-check.mjs",
      reason: "Verify script output inside workspace",
      command: { executable: "node", args: ["verify-check.mjs"] },
    });
    const approved = decideProposal(proposal, {
      actionId: proposal.id,
      decision: "approve",
      scope: "single_action",
    });

    const { action, result } = await executeApprovedCommand(approved, {
      expectedExitCode: 0,
      expectedOutputIncludes: "GATE_OK:42",
    });

    expect(result.state).toBe("PASS");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GATE_OK:42");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(action.status).toBe("executed");
    expect(action.evidence?.state).toBe("PASS");

    // Fails when expected evidence output is not present even if exit code is 0
    const { action: missingEvidenceAction, result: missingEvidenceResult } =
      await executeApprovedCommand(approved, {
        expectedExitCode: 0,
        expectedOutputIncludes: "NON_EXISTENT_TOKEN",
      });
    expect(missingEvidenceResult.state).toBe("FAIL");
    expect(missingEvidenceAction.status).toBe("failed");
    expect(missingEvidenceAction.evidence?.state).toBe("FAIL");
  });

  it("enforces command timeout and cancellation", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-cmd-timeout-"));
    const slowScript = join(tempWorkspace, "slow.mjs");
    await fs.writeFile(
      slowScript,
      "setTimeout(() => console.log('done'), 5000);\n",
      "utf8",
    );

    const proposal = await createProposedAction(tempWorkspace, {
      kind: "run_command",
      description: "Run slow script",
      reason: "Test timeout handling",
      command: { executable: "node", args: ["slow.mjs"] },
    });
    const approved = decideProposal(proposal, {
      actionId: proposal.id,
      decision: "approve",
      scope: "single_action",
    });

    const { action, result } = await executeApprovedCommand(approved, {
      timeoutMs: 120,
    });
    expect(result.timedOut).toBe(true);
    expect(result.state).toBe("FAIL");
    expect(action.status).toBe("failed");

    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 80);
    const { result: cancelledResult } = await executeApprovedCommand(approved, {
      timeoutMs: 5000,
      signal: abortController.signal,
    });
    expect(cancelledResult.cancelled).toBe(true);
    expect(cancelledResult.state).toBe("FAIL");
  });
});

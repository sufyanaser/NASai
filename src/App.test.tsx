import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const workspace: WorkspaceSnapshot = {
  path: "H:\\Projects\\NASai",
  name: "NASai",
  branch: "develop",
  gitAvailable: true,
  dirty: false,
  fileCount: 42,
  rules: ["AGENTS.md", "CLAUDE.md"],
  inspectedAt: "2026-10-11T00:00:00.000Z",
};

const evidence: TaskEvidence = {
  id: "task-1",
  prompt: "Review the update flow",
  workspace: workspace.path,
  startedAt: "2026-10-11T00:00:00.000Z",
  completedAt: "2026-10-11T00:00:01.000Z",
  status: "PASS",
  summary: "Inspected 42 files and captured 3 evidence checks.",
  checks: [],
};

describe("App shell", () => {
  beforeEach(() => {
    window.nasai = {
      getAppInfo: vi.fn().mockResolvedValue({
        version: "0.1.0",
        platform: "win32",
        packaged: false,
      }),
      checkForUpdates: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateStatus: vi.fn(() => () => undefined),
      minimizeWindow: vi.fn(),
      toggleMaximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(workspace),
      selectWorkspace: vi.fn().mockResolvedValue(workspace),
      runTask: vi.fn().mockResolvedValue(evidence),
      onTaskStatus: vi.fn(() => () => undefined),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("presents the real workspace workflow and safety status", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "What should we investigate?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Safe mode")).toBeInTheDocument();
    expect(await screen.findByText("NASai · 42 files inspected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start task ↗" })).toBeDisabled();
  });

  it("runs an evidence task and records the verified result", async () => {
    render(<App />);
    await screen.findByText("NASai · 42 files inspected");
    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Review the update flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start task ↗" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /NASai status: Verified/ }),
      ).toBeInTheDocument(),
    );
    expect(window.nasai?.runTask).toHaveBeenCalledWith(
      "Review the update flow",
    );
    expect(
      screen.getByRole("heading", { name: "Task verified" }),
    ).toBeInTheDocument();
  });

  it("shows attention when the runtime rejects a task", async () => {
    vi.mocked(window.nasai!.runTask).mockRejectedValueOnce(
      new Error("Inspection failed"),
    );
    render(<App />);
    await screen.findByText("NASai · 42 files inspected");
    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Diagnose this error" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start task ↗" }));

    expect(
      await screen.findByRole("button", { name: /NASai status: Needs you/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("I found something that needs your attention."),
    ).toBeVisible();
  });

  it("displays proposed actions, waits in attention state, and supports single-action approve, reject, and edit", async () => {
    const pendingProposal: ProposedAction = {
      id: "prop-123456789abc",
      kind: "edit_file",
      description: "Update configuration in src/config.ts",
      reason: "Enable strict verification gate",
      target: "src/config.ts",
      workspacePath: workspace.path,
      relativePath: "src/config.ts",
      proposedContent: 'export const strict = true;\n',
      riskLevel: "medium",
      requiresApproval: true,
      sensitiveReason: "Modifying an existing workspace file writes to disk",
      preview:
        "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,1 @@\n-export const strict = false;\n+export const strict = true;",
      status: "pending_approval",
      evidence: null,
      recovery: {
        strategy: "file_checkpoint",
        checkpointId: null,
        restorable: true,
        description: "Checkpoint backs up src/config.ts before writing.",
      },
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    };

    window.nasai!.runTask = vi.fn().mockResolvedValue({
      ...evidence,
      proposals: [pendingProposal],
    });
    window.nasai!.editProposal = vi.fn().mockImplementation(
      async (_id: string, edits: ProposalEditInput) => ({
        ...pendingProposal,
        description: edits.description ?? pendingProposal.description,
        proposedContent:
          edits.proposedContent ?? pendingProposal.proposedContent,
        preview:
          "--- a/src/config.ts\n+++ b/src/config.ts\n+export const strict = true; // verified",
      }),
    );
    window.nasai!.decideProposal = vi.fn().mockImplementation(
      async (input: ApprovalDecisionInput) => ({
        ...pendingProposal,
        status: input.decision === "approve" ? "approved" : "rejected",
      }),
    );

    render(<App />);
    await screen.findByText("NASai · 42 files inspected");
    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Propose strict config update" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start task ↗" }));

    expect(
      await screen.findByRole("region", { name: "Proposed actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Single-action approval only · Blanket approvals disabled",
      ),
    ).toBeVisible();
    expect(screen.getByText("▲ RISK: MEDIUM")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /NASai status: Needs you\. Review and approve each sensitive action individually/,
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    fireEvent.change(screen.getByLabelText("Proposal description"), {
      target: { value: "Update config with verified comment" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save proposal edits" }),
    );

    await waitFor(() =>
      expect(window.nasai?.editProposal).toHaveBeenCalledWith(
        "prop-123456789abc",
        expect.objectContaining({
          description: "Update config with verified comment",
        }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Approve single action" }),
    );
    await waitFor(() =>
      expect(window.nasai?.decideProposal).toHaveBeenCalledWith({
        actionId: "prop-123456789abc",
        decision: "approve",
        scope: "single_action",
      }),
    );
    expect(await screen.findByText("APPROVED")).toBeVisible();
  });
});


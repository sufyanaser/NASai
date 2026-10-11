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
});

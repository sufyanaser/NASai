// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorkspace, runEvidenceTask } from "./workspace.js";

let temporaryWorkspace: string | null = null;

afterEach(async () => {
  if (temporaryWorkspace?.startsWith(tmpdir()))
    await fs.rm(temporaryWorkspace, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  temporaryWorkspace = null;
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
});

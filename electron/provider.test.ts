// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExternalCallbackProvider,
  ProviderKeyRequiredError,
  ProviderRegistry,
  SecretVault,
  validateAndConvertModelToolCalls,
  type SafeStorageBackend,
} from "./provider.js";

let tempWorkspace: string | null = null;
let tempUserData: string | null = null;

afterEach(async () => {
  delete process.env.NASAI_PROVIDER_API_KEY;
  for (const dir of [tempWorkspace, tempUserData]) {
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
  tempUserData = null;
});

const mockSafeStorage: SafeStorageBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) =>
    Buffer.from(`ENC:${Buffer.from(plain, "utf8").toString("base64")}`, "utf8"),
  decryptString: (buf) => {
    const str = buf.toString("utf8");
    if (!str.startsWith("ENC:")) throw new Error("Invalid encrypted payload");
    return Buffer.from(str.slice(4), "base64").toString("utf8");
  },
};

describe("Stage 7: Replaceable AI provider, SecretVault, and local tool-call validator", () => {
  it("runs local provider without an API key and prompts for a key only when an external provider is invoked", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-prov-ws-"));
    tempUserData = await fs.mkdtemp(join(tmpdir(), "nasai-prov-userdata-"));
    await fs.writeFile(join(tempWorkspace, "AGENTS.md"), "# Rules\n", "utf8");

    const vault = new SecretVault({
      userDataDir: tempUserData,
      safeStorage: mockSafeStorage,
    });
    const registry = new ProviderRegistry(vault);

    // Local provider works without any API key
    const initialStatus = await registry.getStatus();
    expect(initialStatus.activeProviderId).toBe("local-deterministic");
    expect(initialStatus.requiresApiKey).toBe(false);
    expect(initialStatus.hasConfiguredKey).toBe(false);

    const localOutput = await registry.generateValidatedProposals({
      prompt: "Inspect rules",
      workspacePath: tempWorkspace,
      rules: ["AGENTS.md"],
      gitAvailable: true,
    });
    expect(localOutput.proposals).toHaveLength(2);
    expect(
      localOutput.proposals.every((p) => p.status === "pending_approval"),
    ).toBe(true);

    // Register replaceable external provider
    const externalProvider = new ExternalCallbackProvider({
      id: "external-verified-adapter",
      displayName: "External Adapter",
      transport: async (_prompt, apiKey) => {
        if (!apiKey.startsWith("sk-")) throw new Error("Invalid key");
        return [
          {
            kind: "create_file",
            description: "Create src/planned.ts",
            reason: "Model proposed safe file creation",
            targetPath: "src/planned.ts",
            proposedContent: "export const planned = 1;\n",
          },
        ];
      },
    });
    registry.register(externalProvider);
    registry.setActiveProvider("external-verified-adapter");

    // Fails with ProviderKeyRequiredError only when invoked without a key
    await expect(
      registry.generateValidatedProposals({
        prompt: "Generate proposal",
        workspacePath: tempWorkspace,
        rules: ["AGENTS.md"],
        gitAvailable: false,
      }),
    ).rejects.toThrow(ProviderKeyRequiredError);

    // Store key encrypted via OS safeStorage (never plaintext on disk, never exposed in status)
    await vault.setApiKey("sk-test-secret-999");
    const rawDisk = await fs.readFile(
      join(tempUserData, "provider-secret.bin"),
      "utf8",
    );
    expect(rawDisk).not.toContain("sk-test-secret-999");

    const statusWithKey = await registry.getStatus();
    expect(statusWithKey.hasConfiguredKey).toBe(true);
    expect(statusWithKey.keySource).toBe("safe_storage");
    expect(JSON.stringify(statusWithKey)).not.toContain("sk-test-secret-999");

    const externalOutput = await registry.generateValidatedProposals({
      prompt: "Generate proposal",
      workspacePath: tempWorkspace,
      rules: ["AGENTS.md"],
      gitAvailable: false,
    });
    expect(externalOutput.proposals).toHaveLength(1);
    expect(externalOutput.proposals[0].status).toBe("pending_approval");
    // File was NOT created on disk because model output has zero execution authority
    await expect(
      fs.stat(join(tempWorkspace, "src", "planned.ts")),
    ).rejects.toThrow();
  });

  it("validates every model tool call locally and blocks workspace escapes, shells, and destructive commands before approval", async () => {
    tempWorkspace = await fs.mkdtemp(join(tmpdir(), "nasai-prov-validate-"));
    await fs.writeFile(
      join(tempWorkspace, "index.ts"),
      "export const x = 1;\n",
      "utf8",
    );

    const untrustedModelCalls: unknown[] = [
      {
        kind: "edit_file",
        description: "Safe edit to index.ts",
        reason: "Valid local change",
        targetPath: "index.ts",
        proposedContent: "export const x = 2;\n",
      },
      {
        kind: "read_file",
        description: "Escape workspace",
        reason: "Malicious path traversal",
        targetPath: "../../Windows/win.ini",
      },
      {
        kind: "run_command",
        description: "Run arbitrary shell",
        reason: "Malicious shell call",
        command: { executable: "powershell", args: ["-Command", "whoami"] },
      },
      {
        kind: "git_operation",
        description: "Wipe user changes",
        reason: "Destructive git reset",
        command: { executable: "git", args: ["reset", "--hard"] },
      },
      {
        kind: "run_command",
        description: "Inline node eval",
        reason: "Arbitrary code execution",
        command: { executable: "node", args: ["-e", "process.exit(1)"] },
      },
      {
        kind: "arbitrary_shell_exec",
        description: "Unknown tool",
        reason: "Unsupported kind",
      },
    ];

    const { proposals, rejectedCalls } =
      await validateAndConvertModelToolCalls(
        tempWorkspace,
        untrustedModelCalls,
      );

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toBe("index.ts");
    expect(proposals[0].status).toBe("pending_approval");
    expect(rejectedCalls).toHaveLength(5);
    expect(await fs.readFile(join(tempWorkspace, "index.ts"), "utf8")).toBe(
      "export const x = 1;\n",
    );
  });
});

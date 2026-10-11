import { promises as fs } from "node:fs";
import { join } from "node:path";
import { validateCommandSpec } from "./commandRunner.js";
import {
  createProposedAction,
  resolveWorkspaceTarget,
  type ActionKind,
  type CommandSpec,
  type ProposedAction,
} from "./proposals.js";

export interface RawModelToolCall {
  kind: string;
  description?: string;
  reason?: string;
  targetPath?: string;
  proposedContent?: string;
  command?: CommandSpec;
}

export interface RejectedModelToolCall {
  rawCall: unknown;
  reason: string;
}

export interface ValidatedProviderOutput {
  providerId: string;
  proposals: ProposedAction[];
  rejectedCalls: RejectedModelToolCall[];
}

export interface SafeStorageBackend {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

export interface ProviderStatus {
  activeProviderId: string;
  requiresApiKey: boolean;
  hasConfiguredKey: boolean;
  keySource: "env" | "safe_storage" | "none";
}

export class ProviderKeyRequiredError extends Error {
  readonly code = "API_KEY_REQUIRED";
  constructor(providerId: string) {
    super(
      `Provider "${providerId}" requires an API key. Configure a key in system secure storage or NASAI_PROVIDER_API_KEY before invoking an external model.`,
    );
    this.name = "ProviderKeyRequiredError";
  }
}

export class SecretVault {
  private readonly storeFilePath: string;
  private readonly safeStorage: SafeStorageBackend | null;
  private readonly envVarName: string;

  constructor(options: {
    userDataDir: string;
    safeStorage?: SafeStorageBackend | null;
    envVarName?: string;
  }) {
    this.storeFilePath = join(options.userDataDir, "provider-secret.bin");
    this.safeStorage = options.safeStorage ?? null;
    this.envVarName = options.envVarName ?? "NASAI_PROVIDER_API_KEY";
  }

  async getKeyStatus(): Promise<{
    hasConfiguredKey: boolean;
    keySource: "env" | "safe_storage" | "none";
  }> {
    const envVal = process.env[this.envVarName]?.trim();
    if (envVal) {
      return { hasConfiguredKey: true, keySource: "env" };
    }
    try {
      const stat = await fs.stat(this.storeFilePath);
      if (stat.isFile() && stat.size > 0) {
        return { hasConfiguredKey: true, keySource: "safe_storage" };
      }
    } catch {
      // No stored key file.
    }
    return { hasConfiguredKey: false, keySource: "none" };
  }

  async setApiKey(plainKey: string): Promise<void> {
    const trimmed = plainKey.trim();
    if (!trimmed) {
      throw new Error("API key cannot be empty.");
    }
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS safeStorage encryption is unavailable; use the NASAI_PROVIDER_API_KEY environment variable instead.",
      );
    }
    const encrypted = this.safeStorage.encryptString(trimmed);
    await fs.writeFile(this.storeFilePath, encrypted);
  }

  async clearApiKey(): Promise<void> {
    try {
      await fs.rm(this.storeFilePath, { force: true });
    } catch {
      // Ignore missing file.
    }
  }

  async retrieveApiKeyForMainProcessOnly(): Promise<string | null> {
    const envVal = process.env[this.envVarName]?.trim();
    if (envVal) return envVal;
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      const encrypted = await fs.readFile(this.storeFilePath);
      const decrypted = this.safeStorage.decryptString(encrypted).trim();
      return decrypted || null;
    } catch {
      return null;
    }
  }
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly requiresApiKey: boolean;
  proposeToolCalls: (
    context: {
      prompt: string;
      workspacePath: string;
      rules: string[];
      gitAvailable: boolean;
    },
    getApiKey: () => Promise<string | null>,
  ) => Promise<RawModelToolCall[]>;
}

const VALID_KINDS = new Set<ActionKind>([
  "read_file",
  "create_file",
  "edit_file",
  "delete_file",
  "run_command",
  "git_operation",
]);

export async function validateAndConvertModelToolCalls(
  workspacePath: string,
  rawCalls: unknown[],
): Promise<{
  proposals: ProposedAction[];
  rejectedCalls: RejectedModelToolCall[];
}> {
  const proposals: ProposedAction[] = [];
  const rejectedCalls: RejectedModelToolCall[] = [];

  for (const item of rawCalls) {
    if (!item || typeof item !== "object") {
      rejectedCalls.push({
        rawCall: item,
        reason: "Tool call must be a structured object.",
      });
      continue;
    }

    const call = item as RawModelToolCall;
    if (!VALID_KINDS.has(call.kind as ActionKind)) {
      rejectedCalls.push({
        rawCall: item,
        reason: `Unsupported or unverified tool kind "${String(call.kind)}".`,
      });
      continue;
    }

    const kind = call.kind as ActionKind;
    const description = (call.description ?? "").trim();
    const reason = (call.reason ?? "").trim();

    if (!description || !reason) {
      rejectedCalls.push({
        rawCall: item,
        reason: "Tool call must include both description and reason.",
      });
      continue;
    }

    try {
      if (kind === "run_command" || kind === "git_operation") {
        if (!call.command) {
          throw new Error("Missing structured command specification.");
        }
        validateCommandSpec(workspacePath, call.command);
      } else {
        if (!call.targetPath) {
          throw new Error("Missing targetPath for file operation.");
        }
        resolveWorkspaceTarget(workspacePath, call.targetPath);
      }

      const proposal = await createProposedAction(workspacePath, {
        kind,
        description,
        reason,
        targetPath: call.targetPath,
        proposedContent: call.proposedContent,
        command: call.command,
      });

      // Model output never receives execution authority; always pending_approval.
      proposals.push({
        ...proposal,
        status: "pending_approval",
      });
    } catch (error) {
      rejectedCalls.push({
        rawCall: item,
        reason:
          error instanceof Error
            ? error.message
            : "Failed local tool-call validation.",
      });
    }
  }

  return { proposals, rejectedCalls };
}

export class LocalDeterministicProvider implements AIProviderAdapter {
  readonly id = "local-deterministic";
  readonly displayName = "Local Evidence Planner (No API Key Required)";
  readonly requiresApiKey = false;

  async proposeToolCalls(context: {
    prompt: string;
    workspacePath: string;
    rules: string[];
    gitAvailable: boolean;
  }): Promise<RawModelToolCall[]> {
    const calls: RawModelToolCall[] = [];
    if (context.rules.length > 0) {
      calls.push({
        kind: "read_file",
        description: `Read rule file ${context.rules[0]}`,
        reason: `Load project rules before acting on: ${context.prompt.slice(0, 60)}`,
        targetPath: context.rules[0],
      });
    }
    if (context.gitAvailable) {
      calls.push({
        kind: "git_operation",
        description: "Inspect Git working tree status",
        reason: "Verify repository state before proposing changes",
        command: { executable: "git", args: ["status", "--short"] },
      });
    }
    return calls;
  }
}

export class ExternalCallbackProvider implements AIProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly requiresApiKey = true;
  private readonly transport: (
    prompt: string,
    apiKey: string,
  ) => Promise<RawModelToolCall[]>;

  constructor(options: {
    id: string;
    displayName: string;
    transport: (prompt: string, apiKey: string) => Promise<RawModelToolCall[]>;
  }) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.transport = options.transport;
  }

  async proposeToolCalls(
    context: {
      prompt: string;
      workspacePath: string;
      rules: string[];
      gitAvailable: boolean;
    },
    getApiKey: () => Promise<string | null>,
  ): Promise<RawModelToolCall[]> {
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new ProviderKeyRequiredError(this.id);
    }
    return this.transport(context.prompt, apiKey);
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProviderAdapter>();
  private activeProviderId: string;
  private readonly vault: SecretVault;

  constructor(vault: SecretVault, defaultProvider?: AIProviderAdapter) {
    this.vault = vault;
    const initial = defaultProvider ?? new LocalDeterministicProvider();
    this.providers.set(initial.id, initial);
    this.activeProviderId = initial.id;
  }

  register(provider: AIProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  setActiveProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider "${providerId}" is not registered.`);
    }
    this.activeProviderId = providerId;
  }

  async getStatus(): Promise<ProviderStatus> {
    const active = this.providers.get(this.activeProviderId)!;
    const keyStatus = await this.vault.getKeyStatus();
    return {
      activeProviderId: active.id,
      requiresApiKey: active.requiresApiKey,
      hasConfiguredKey: keyStatus.hasConfiguredKey,
      keySource: keyStatus.keySource,
    };
  }

  async generateValidatedProposals(context: {
    prompt: string;
    workspacePath: string;
    rules: string[];
    gitAvailable: boolean;
  }): Promise<ValidatedProviderOutput> {
    const active = this.providers.get(this.activeProviderId);
    if (!active) {
      throw new Error("No active AI provider configured.");
    }
    const rawCalls = await active.proposeToolCalls(context, () =>
      this.vault.retrieveApiKeyForMainProcessOnly(),
    );
    const { proposals, rejectedCalls } =
      await validateAndConvertModelToolCalls(context.workspacePath, rawCalls);
    return {
      providerId: active.id,
      proposals,
      rejectedCalls,
    };
  }
}

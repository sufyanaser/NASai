# Workspace and Task Engine

## Current capability

NASai selects and remembers a Windows workspace, inspects it safely, and enforces a full proposal, single-action approval, external checkpoint, restricted command execution, and evidence ledger cycle:

- canonical workspace path and name;
- bounded file count, excluding generated (`release-*`, `dist*`, `node_modules`) directories;
- supported project-rule files (`AGENTS.md`, `CLAUDE.md`, `OPERATING-CHARTER.md`, `FORBIDDEN-ASSUMPTIONS.md`);
- Git availability, branch, and porcelain working-tree state;
- unified `ProposedAction` model (`read_file`, `create_file`, `edit_file`, `delete_file`, `run_command`, `git_operation`) with deterministic IDs, unified diffs, risk levels, recovery plans, and single-action approval gates;
- external recovery checkpoints stored in Electron's per-user application-data directory (`userData/checkpoints`) with pre- and post-change SHA-256 verification and non-destructive single-file rollback that preserves unrelated uncommitted user changes;
- restricted command execution (`shell: false`, executable allowlist, destructive-Git-flag blocking, workspace path confinement, timeout, cancellation, and exit-code + expected-output validation);
- replaceable AI provider layer (`ProviderRegistry` + `SecretVault` backed by OS `safeStorage` or `NASAI_PROVIDER_API_KEY`) that validates every untrusted tool call locally and converts valid calls into `pending_approval` proposals without granting direct execution authority;
- timestamped task and evidence records stored under `userData/tasks.json` and capped at 50 records.

## Evidence states

- `PASS`: the check ran and its required evidence was found.
- `FAIL`: the check ran and its acceptance condition failed.
- `NOT VERIFIED`: the environment did not provide enough evidence, such as a non-Git folder, missing rule files, or a rejected/unexecuted action.

An overall task is `PASS` only when every required check passes. A missing rule file, missing Git repository, or rejected proposal produces `NOT VERIFIED`, never a false success.

## Security boundary

- The renderer never receives Node.js, direct filesystem, shell, environment, or raw API credential access (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- Folder selection is performed by Electron's native dialog.
- Filesystem, checkpoint, command, and provider operations run in the main process through a narrow preload bridge.
- Commands use argument arrays and an allowlisted executable with `shell: false`; neither user prompts nor model outputs are interpolated into a shell command.
- Blanket or session-wide approvals are forbidden; every write, delete, command, or Git action requires explicit single-action approval.
- Destructive Git commands (`git reset --hard`, `git checkout --`, `git clean -f`, force push) are blocked by policy.
- Task history and recovery checkpoints are stored outside both the installed application directory and the selected repository.

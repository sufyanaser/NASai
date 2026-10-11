# Workspace and Task Engine

## Current capability

NASai can select and remember a real Windows workspace, then inspect it without modifying project files. The inspection captures:

- canonical workspace path and name;
- bounded file count, excluding generated and dependency directories;
- supported project-rule files;
- Git availability, branch, and clean/changed state;
- timestamped task evidence stored under Electron's per-user application-data directory.

## Evidence states

- `PASS`: the check ran and its required evidence was found.
- `FAIL`: the check ran and its acceptance condition failed.
- `NOT VERIFIED`: the environment did not provide enough evidence, such as a non-Git folder or missing rule files.

An overall task is `PASS` only when every current preflight check passes. A missing rule file or Git repository produces `NOT VERIFIED`, never a false success.

## Security boundary

- The renderer never receives Node.js or direct filesystem access.
- Folder selection is performed by Electron's native dialog.
- Filesystem and Git inspection run in the main process through a narrow preload bridge.
- Git commands use argument arrays and a fixed executable; task text is never interpolated into a shell command.
- This phase is read-only. It does not execute arbitrary commands or edit workspace files.
- Task history is stored outside the selected repository and capped at 50 records.

## Deliberately deferred

The current engine is a trustworthy discovery and evidence foundation, not yet an AI coding runtime. Model-provider integration, proposed file changes, command approvals, recovery checkpoints, and write execution require separate scoped stages and their own verification.

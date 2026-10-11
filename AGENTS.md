# AGENTS.md

## Mission

Build NASai as a trustworthy Windows coding agent. Optimize for verified user outcomes, not the amount of code produced.

## Required workflow

1. Discover the repository, branch, rules, and existing changes.
2. Record the baseline as `PASS`, `FAIL`, or `NOT VERIFIED`.
3. Select the smallest testable scope.
4. Implement without overwriting unrelated work.
5. Run `npm run verify`.
6. Review the diff and evidence.
7. Commit or push only when required gates pass.

## Safety rules

- Never modify a workspace outside explicit scope.
- Never expose credentials in files, logs, commits, or renderer code.
- Do not disable a failing check to make CI green.
- Do not claim a packaged build was installed or upgraded unless that happened on the target machine.
- Do not run destructive Git commands without explicit user approval.
- Stop for secrets, irreversible external actions, or mandatory real-device verification.
- Keep Electron `contextIsolation`, sandboxing, and disabled renderer Node integration.

## Scope rules

The current product is an AppShell foundation. Do not add an agent runtime, database, authentication, cloud backend, multi-agent orchestration, or model provider until a scoped feature requires it.

## Branch and release rules

- Develop from `develop`; release through `main`.
- SemVer tags are immutable.
- A push is not an installable update.
- A GitHub Release must contain the installer and update metadata.
- Automatic updates remain `NOT VERIFIED` until a real older installed version upgrades successfully.

See `docs/knowledge/` for the canonical policy set.

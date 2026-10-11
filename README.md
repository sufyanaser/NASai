# NASai

NASai is a Windows desktop shell for an evidence-driven coding agent. This repository currently contains the foundation: a secure Electron host, a focused React AppShell, documented operating rules, automated quality gates, and a release/update path.

> **Current status:** foundation only. The interface is real and packaged; the coding-agent execution engine is intentionally not implemented yet. Installer execution and upgrade behavior remain `NOT VERIFIED` until tested on a Windows user machine.

## Principles

- Work only inside an explicitly authorized workspace.
- Load project rules before changing files.
- Report `PASS`, `FAIL`, and `NOT VERIFIED` separately.
- Never commit or publish after a failed required gate.
- Keep sensitive actions behind human approval.
- Prefer recoverable, narrowly scoped changes.

## Development

Requirements: Node.js 20.19+ and npm 10+ on Windows.

```powershell
npm install
npm run dev
```

Quality gates:

```powershell
npm run verify
```

Create a local Windows installer candidate:

```powershell
npm run package:win
```

The installer is written to `release/`. Building an installer does not prove installation or automatic update behavior; follow [the release policy](docs/knowledge/GIT-CI-RELEASE-POLICY.md).

## Architecture

- `electron/`: sandboxed Electron host, narrow preload bridge, update lifecycle.
- `src/`: React AppShell and UI tests.
- `assets/NASai.ico`: canonical application, window, installer, shortcut, and UI icon.
- `docs/knowledge/`: operating charter and evidence-backed project rules.
- `.github/workflows/`: pull-request quality gates and tag-based Windows release candidates.

No credentials are stored in this repository. Persistent user data must use Electron's `userData` directory when introduced, so installers and upgrades do not overwrite it.

## Branches

- `main`: releasable history.
- `develop`: integration branch and default development base.

Changes should reach `main` only after the required gates pass and the diff is reviewed.

## Verification status

| Capability                                      | Status                  | Evidence                            |
| ----------------------------------------------- | ----------------------- | ----------------------------------- |
| Lint, typecheck, unit tests, web/Electron build | Automated               | `npm run verify` and CI             |
| Windows NSIS artifact generation                | Automated on Windows CI | tag release workflow                |
| Installer launches on the user's machine        | NOT VERIFIED            | manual installation required        |
| Upgrade from an older installed release         | NOT VERIFIED            | two-version upgrade test required   |
| User data survives upgrade                      | NOT VERIFIED            | migration/persistence test required |

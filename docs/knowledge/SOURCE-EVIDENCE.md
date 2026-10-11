# Source and Evidence Register

| ID       | Claim or decision                                                 | Source                                                                       | Confidence                                          | Verified date |
| -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- | ------------- |
| KB-001   | Use evidence-based status and separate installed-app verification | Supplied `NAS Engineering Knowledge Base.md` v1.0                            | Guidance; historical audit incomplete               | 2026-10-11    |
| REPO-001 | Remote repository began with no branches or tracked files         | `git ls-remote --heads origin` returned no heads                             | Direct repository evidence                          | 2026-10-11    |
| APP-001  | Initial scope is Electron + React AppShell with no agent runtime  | User request plus scope review                                               | Approved implementation decision                    | 2026-10-11    |
| GATE-001 | Lint, typecheck, unit test, web build, and Electron build pass    | `npm run verify`, exit code 0; 1 test passed                                 | Local automated evidence                            | 2026-10-11    |
| PKG-001  | Windows NSIS candidate and updater metadata can be generated      | `npm run package:win`, exit code 0; EXE, blockmap, and `latest.yml` produced | Local packaging evidence; not installation evidence | 2026-10-11    |
| HASH-001 | Installer candidate identity                                      | SHA-256 `B8B1BA5B582EBFF5DB4F91E039C2D0C5B168297F2598E810A7CB2D6289563AAD`   | Direct artifact evidence                            | 2026-10-11    |
| SEC-001  | Runtime dependency audit found no known vulnerabilities           | `npm audit --omit=dev`, 0 vulnerabilities                                    | Local registry audit evidence                       | 2026-10-11    |

Append gate runs, artifact hashes, release URLs, installer checks, and upgrade checks as they occur.

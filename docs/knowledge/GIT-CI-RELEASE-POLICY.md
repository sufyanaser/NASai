# Git, CI, and Release Policy

## Branches

- `develop` is the integration base.
- `main` contains releasable history.
- Required gates: lint, typecheck, tests, and build.
- Do not commit or push known failing required gates.

## Release flow

1. Merge verified work into `main`.
2. Set one consistent SemVer version.
3. Create a new immutable `vX.Y.Z` tag.
4. CI builds the Windows NSIS installer and updater metadata.
5. The release workflow publishes those exact artifacts to GitHub Releases.
6. Install the prior release on a real Windows environment.
7. Verify detection, download, restart/install, version change, and data preservation.
8. Record outcomes in `SOURCE-EVIDENCE.md`; failures go to `INCIDENT-REGISTER.md`.

## Update implementation

`electron-updater` checks GitHub Releases only in packaged builds. It downloads an available update and installs on quit; the UI can request immediate restart/install after download.

This is implementation evidence only; each new release remains `NOT VERIFIED` until steps 6–8 run on a real Windows environment. For `v0.2.0`, real Windows installation (`RELEASE-001`) and automatic upgrade from `v0.1.0` to `v0.2.0` (`UPGRADE-001`) reached `PASS`.

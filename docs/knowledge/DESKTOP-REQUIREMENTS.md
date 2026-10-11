# Windows Desktop Requirements

## Release acceptance

- Professional EXE installer.
- Trusted automatic-update feed and immutable SemVer releases.
- Release includes installer and updater metadata.
- No unnecessary terminal windows during normal operation.
- Settings and project data persist outside the installed application directory.
- Arabic/RTL and UTF-8 rendering are reviewed.
- Layout works at the documented minimum viewport.
- Errors explain recovery or retry actions.
- UI, package, and release versions agree.
- Installer and upgrade are tested on an actual Windows user environment.

The codebase and CI can prepare these capabilities. They do not satisfy the final two real-device checks by themselves.

## Viewport contract

The initial AppShell supports a minimum window of 1080×700 and targets 1440×900. Content density and navigation must remain usable at the minimum size.

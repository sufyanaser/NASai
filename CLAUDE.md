# CLAUDE.md

Follow `AGENTS.md` and all documents under `docs/knowledge/`.

Before editing, inspect the working tree and read the applicable policy. Keep changes narrow and evidence-based. Run `npm run verify` before any commit or push. Never represent CI, packaging, installation, and upgrade verification as equivalent outcomes.

The renderer must not receive direct filesystem, shell, environment, or credential access. Add only narrow, validated preload APIs for approved features.
